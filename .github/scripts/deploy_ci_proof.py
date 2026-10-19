"""Authorize TypeShift source without executing it; fail closed on stale CI proof."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPOSITORY = "elephancy/TypeShift"
WORKFLOW_PATH = ".github/workflows/ci.yml"
REQUIRED_JOB = "test-and-build"


class ProofError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ProofError(message)


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "Invalid source commit")
    return value


def positive_integer(value):
    require(type(value) is int and value > 0, "Missing CI run/attempt identity")
    return value


def same_repository(value):
    return isinstance(value, dict) and value.get("full_name") == REPOSITORY


def authorize(context, get):
    """Return immutable checkout identity; get is the authenticated GitHub API seam."""
    require(context.get("repository") == REPOSITORY, "Unexpected deployment repository")
    event = context.get("event_name")
    require(event in ("workflow_run", "workflow_dispatch"), "Unexpected deployment event")
    prefix = "/repos/" + REPOSITORY
    if event == "workflow_dispatch":
        ref = context.get("ref", "")
        require(isinstance(ref, str) and ref.startswith(("refs/heads/", "refs/tags/")) and ref.split("/", 2)[2], "Manual deployment needs a branch or tag")
        source = sha(context.get("sha"))
        resolved = get(prefix + "/commits/" + quote(ref, safe=""))
        require(resolved.get("sha") == source, "Manual source reference moved")
        return {"source_sha": source, "reuse_ci": False, "run_id": None, "run_attempt": None}

    trigger = context.get("workflow_run")
    require(isinstance(trigger, dict), "Missing triggering CI proof")
    run_id = positive_integer(trigger.get("id"))
    attempt = positive_integer(trigger.get("run_attempt"))
    source = sha(trigger.get("head_sha"))
    require(trigger.get("status") == "completed" and trigger.get("conclusion") == "success", "Triggering CI did not succeed")
    require(trigger.get("event") == "push", "Only push CI can authorize automatic deployment")
    require(same_repository(trigger.get("repository")) and same_repository(trigger.get("head_repository")), "Fork or foreign CI proof")

    repository = get(prefix)
    require(repository.get("full_name") == REPOSITORY, "Repository identity changed")
    branch = repository.get("default_branch")
    require(isinstance(branch, str) and branch, "Missing default branch")
    require(trigger.get("head_branch") == branch, "CI is not for the current default branch")
    require(context.get("ref") == "refs/heads/" + branch and context.get("sha") == source, "Caller default-branch source differs from CI")
    workflow = get(prefix + "/actions/workflows/ci.yml")
    require(workflow.get("path") == WORKFLOW_PATH and workflow.get("name") == "CI" and workflow.get("state") == "active", "Expected CI workflow is unavailable")
    workflow_id = positive_integer(workflow.get("id"))
    require(trigger.get("workflow_id") == workflow_id, "Wrong triggering workflow")
    latest = get(prefix + "/actions/runs/" + str(run_id))
    require(latest.get("id") == run_id and latest.get("workflow_id") == workflow_id, "CI run identity changed")
    require(latest.get("run_attempt") == attempt, "CI was rerun after this proof")
    require(latest.get("status") == "completed" and latest.get("conclusion") == "success", "Current CI attempt did not succeed")
    require(latest.get("event") == "push" and latest.get("head_branch") == branch and latest.get("head_sha") == source, "CI source/event identity changed")
    require(same_repository(latest.get("repository")) and same_repository(latest.get("head_repository")), "Current CI is foreign or fork sourced")
    require(str(latest.get("path", "")).split("@", 1)[0] == WORKFLOW_PATH, "Unexpected CI definition path")
    jobs = get(prefix + f"/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
    require(type(jobs.get("total_count")) is int and 0 < jobs["total_count"] <= 100 and isinstance(jobs.get("jobs"), list) and len(jobs["jobs"]) == jobs["total_count"], "Incomplete CI job proof")
    expected = [j for j in jobs.get("jobs", []) if j.get("name") == REQUIRED_JOB]
    require(len(expected) == 1 and expected[0].get("status") == "completed" and expected[0].get("conclusion") == "success", "Required CI validation job did not pass")
    require(expected[0].get("head_sha") == source, "Required CI job has a different source")
    ref = get(prefix + "/git/ref/heads/" + quote(branch, safe=""))
    require(ref.get("ref") == "refs/heads/" + branch and ref.get("object", {}).get("type") == "commit" and ref["object"].get("sha") == source, "Default branch advanced beyond the validated source")
    return {"source_sha": source, "reuse_ci": True, "run_id": run_id, "run_attempt": attempt}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProofError("GitHub API redirect refused")


def github_get(token):
    require(isinstance(token, str) and token, "Read-only GitHub token is missing")
    opener = build_opener(NoRedirect)

    def get(path):
        require(path.startswith("/repos/" + REPOSITORY), "Unexpected GitHub API path")
        request = Request("https://api.github.com" + path, headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        try:
            with opener.open(request, timeout=20) as response:
                require(response.status == 200, "GitHub CI proof request failed")
                data = response.read(2 * 1024 * 1024 + 1)
                require(len(data) <= 2 * 1024 * 1024, "GitHub proof response exceeded its limit")
                result = json.loads(data)
                require(isinstance(result, dict), "GitHub proof response is not an object")
                return result
        except ProofError:
            raise
        except Exception as error:
            raise ProofError("GitHub CI proof could not be verified") from error

    return get


def context_from_environment(environ):
    try:
        trigger = json.loads(environ.get("CI_TRIGGER", "null"))
    except (TypeError, json.JSONDecodeError) as error:
        raise ProofError("Triggering CI event is invalid") from error
    return {"repository": environ.get("SOURCE_REPOSITORY"), "event_name": environ.get("SOURCE_EVENT"), "ref": environ.get("SOURCE_REF"), "sha": environ.get("SOURCE_SHA"), "workflow_run": trigger}


def revalidate(context, expected, get):
    current = authorize(context, get)
    require(current == expected, "Deployment source/proof changed after authorization")
    return current


def main(argv=None, environ=None):
    args = sys.argv[1:] if argv is None else argv
    env = os.environ if environ is None else environ
    require(args in (["authorize"], ["revalidate"]), "Choose authorize or revalidate")
    context = context_from_environment(env)
    get = github_get(env.get("GH_TOKEN"))
    if args == ["authorize"]:
        proof = authorize(context, get)
        output = env.get("GITHUB_OUTPUT")
        require(isinstance(output, str) and output, "Action output file is missing")
        with open(output, "a", encoding="utf-8") as handle:
            handle.write("proof=" + json.dumps(proof, separators=(",", ":")) + "\n")
            handle.write("source_sha=" + proof["source_sha"] + "\n")
            handle.write("reuse_ci=" + str(proof["reuse_ci"]).lower() + "\n")
            handle.write("helper_sha256=" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest() + "\n")
    else:
        try:
            proof = json.loads(env.get("EXPECTED_PROOF", ""))
        except (TypeError, json.JSONDecodeError) as error:
            raise ProofError("Authorized deployment proof is missing") from error
        revalidate(context, proof, get)
    print("Deployment source and CI proof verified")


if __name__ == "__main__":
    try:
        main()
    except ProofError as error:
        print("::error::" + str(error), file=sys.stderr)
        raise SystemExit(1)
