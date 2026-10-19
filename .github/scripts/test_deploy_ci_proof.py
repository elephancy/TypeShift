"""Negative authorization and race tests; no network/provider calls or credentials."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("deploy_ci_proof", Path(__file__).with_name("deploy_ci_proof.py"))
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)
SOURCE = "a" * 40
OTHER = "b" * 40
PREFIX = "/repos/elephancy/TypeShift"


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        repo = {"full_name": "elephancy/TypeShift"}
        run = {"id": 84, "run_attempt": 2, "workflow_id": 42, "head_sha": SOURCE, "head_branch": "main", "status": "completed", "conclusion": "success", "event": "push", "repository": repo, "head_repository": repo, "path": ".github/workflows/ci.yml"}
        self.context = {"repository": "elephancy/TypeShift", "event_name": "workflow_run", "ref": "refs/heads/main", "sha": SOURCE, "workflow_run": copy.deepcopy(run)}
        self.data = {PREFIX: {"full_name": "elephancy/TypeShift", "default_branch": "main"}, PREFIX + "/actions/workflows/ci.yml": {"id": 42, "name": "CI", "path": ".github/workflows/ci.yml", "state": "active"}, PREFIX + "/actions/runs/84": copy.deepcopy(run), PREFIX + "/actions/runs/84/attempts/2/jobs?per_page=100": {"total_count": 1, "jobs": [{"name": "test-and-build", "status": "completed", "conclusion": "success", "head_sha": SOURCE}]}, PREFIX + "/git/ref/heads/main": {"ref": "refs/heads/main", "object": {"type": "commit", "sha": SOURCE}}}
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        return copy.deepcopy(self.data[path])

    def test_valid_current_main_exact_attempt_requires_real_job_success(self):
        actual = proof.authorize(self.context, self.get)
        self.assertEqual(actual, {"source_sha": SOURCE, "reuse_ci": True, "run_id": 84, "run_attempt": 2})
        self.assertIn(PREFIX + "/actions/runs/84/attempts/2/jobs?per_page=100", self.calls)

    def test_invalid_trigger_identities_fail_before_checkout(self):
        cases = [("event", "pull_request"), ("status", "in_progress"), ("conclusion", "failure"), ("conclusion", "neutral"), ("head_branch", "feature"), ("head_sha", "bad"), ("workflow_id", 43), ("id", None), ("run_attempt", None), ("run_attempt", True), ("repository", {"full_name": "attacker/TypeShift"}), ("head_repository", {"full_name": "attacker/TypeShift"})]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                context = copy.deepcopy(self.context)
                context["workflow_run"][key] = value
                with self.assertRaises(proof.ProofError):
                    proof.authorize(context, self.get)

    def test_missing_or_foreign_workflow_event_is_not_authority(self):
        for context in ({}, {**self.context, "repository": "attacker/TypeShift"}, {**self.context, "event_name": "pull_request"}, {**self.context, "workflow_run": None}):
            with self.subTest(context=context), self.assertRaises(proof.ProofError):
                proof.authorize(context, self.get)

    def test_caller_ref_or_sha_cannot_disagree_with_ci_source(self):
        for key, value in (("ref", "refs/heads/feature"), ("ref", "refs/tags/v1"), ("sha", OTHER), ("sha", None)):
            with self.subTest(key=key, value=value), self.assertRaises(proof.ProofError):
                proof.authorize({**self.context, key: value}, self.get)

    def test_latest_api_run_cannot_disagree_with_trigger(self):
        cases = [("id", 85), ("workflow_id", 43), ("run_attempt", 3), ("status", "queued"), ("conclusion", "failure"), ("event", "pull_request"), ("head_branch", "feature"), ("head_sha", OTHER), ("repository", {"full_name": "attacker/TypeShift"}), ("head_repository", {"full_name": "attacker/TypeShift"}), ("path", ".github/workflows/other.yml")]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                original = self.data[PREFIX + "/actions/runs/84"]
                self.data[PREFIX + "/actions/runs/84"] = {**original, key: value}
                try:
                    with self.assertRaises(proof.ProofError):
                        proof.authorize(self.context, self.get)
                finally:
                    self.data[PREFIX + "/actions/runs/84"] = original

    def test_disabled_or_replaced_workflow_cannot_supply_proof(self):
        key = PREFIX + "/actions/workflows/ci.yml"
        original = self.data[key]
        for changes in ({"state": "disabled_manually"}, {"name": "Untrusted"}, {"path": ".github/workflows/release.yml"}, {"id": 43}):
            with self.subTest(changes=changes):
                self.data[key] = {**original, **changes}
                with self.assertRaises(proof.ProofError):
                    proof.authorize(self.context, self.get)
        self.data[key] = original

    def test_skipped_missing_duplicate_wrong_source_jobs_fail(self):
        key = PREFIX + "/actions/runs/84/attempts/2/jobs?per_page=100"
        job = self.data[key]["jobs"][0]
        cases = [{"total_count": 0, "jobs": []}, {"total_count": 2, "jobs": [job, job]}, {"total_count": 101, "jobs": [job]}]
        cases += [{"total_count": 1, "jobs": [{**job, field: value}]} for field, value in (("status", "queued"), ("conclusion", "skipped"), ("conclusion", "neutral"), ("conclusion", "failure"), ("head_sha", OTHER), ("name", "different-check"))]
        for data in cases:
            with self.subTest(data=data):
                self.data[key] = data
                with self.assertRaises(proof.ProofError):
                    proof.authorize(self.context, self.get)

    def test_stale_main_and_noncommit_ref_fail(self):
        key = PREFIX + "/git/ref/heads/main"
        for data in ({"ref": "refs/heads/main", "object": {"type": "commit", "sha": OTHER}}, {"ref": "refs/heads/feature", "object": {"type": "commit", "sha": SOURCE}}, {"ref": "refs/heads/main", "object": {"type": "tag", "sha": SOURCE}}):
            with self.subTest(data=data):
                self.data[key] = data
                with self.assertRaises(proof.ProofError):
                    proof.authorize(self.context, self.get)

    def test_main_move_and_rerun_after_authorization_are_rechecked(self):
        expected = proof.authorize(self.context, self.get)
        self.data[PREFIX + "/git/ref/heads/main"]["object"]["sha"] = OTHER
        with self.assertRaises(proof.ProofError):
            proof.revalidate(self.context, expected, self.get)
        self.data[PREFIX + "/git/ref/heads/main"]["object"]["sha"] = SOURCE
        self.data[PREFIX + "/actions/runs/84"]["run_attempt"] = 3
        with self.assertRaises(proof.ProofError):
            proof.revalidate(self.context, expected, self.get)

    def test_altered_authorized_proof_cannot_change_checkout(self):
        expected = proof.authorize(self.context, self.get)
        with self.assertRaises(proof.ProofError):
            proof.revalidate(self.context, {**expected, "source_sha": OTHER}, self.get)

    def test_manual_branch_and_tag_keep_full_checks_without_ci_reuse(self):
        for ref in ("refs/heads/main", "refs/tags/v1.2.3"):
            with self.subTest(ref=ref):
                self.calls.clear()
                self.data[PREFIX + "/commits/" + proof.quote(ref, safe="")] = {"sha": SOURCE}
                result = proof.authorize({**self.context, "event_name": "workflow_dispatch", "ref": ref}, self.get)
                self.assertEqual(result, {"source_sha": SOURCE, "reuse_ci": False, "run_id": None, "run_attempt": None})
                self.assertFalse(any("/actions/" in path for path in self.calls))

    def test_manual_reference_move_is_rechecked(self):
        context = {**self.context, "event_name": "workflow_dispatch", "ref": "refs/tags/v1"}
        key = PREFIX + "/commits/" + proof.quote(context["ref"], safe="")
        self.data[key] = {"sha": SOURCE}
        expected = proof.authorize(context, self.get)
        self.data[key] = {"sha": OTHER}
        with self.assertRaises(proof.ProofError):
            proof.revalidate(context, expected, self.get)


class WorkflowContractTests(unittest.TestCase):
    def workflow(self):
        return (Path(__file__).parents[1] / "workflows/release.yml").read_text()

    def test_automatic_deployment_is_downstream_of_ci_not_push(self):
        events = self.workflow().split("concurrency:", 1)[0]
        self.assertIn("workflow_run:", events)
        self.assertIn("workflows: [CI]", events)
        self.assertIn("workflow_dispatch:", events)
        self.assertNotIn("\n  push:", events)

    def test_proof_precedes_checkout_and_credentials_only_enter_final_guarded_step(self):
        workflow = self.workflow()
        self.assertLess(workflow.index("name: Authorize deployment source before checkout"), workflow.index("name: Checkout"))
        self.assertIn("ref: ${{ steps.proof.outputs.source_sha }}", workflow)
        self.assertNotIn("CLOUDFLARE_API_TOKEN", workflow.split("    steps:", 1)[0])
        self.assertNotIn("CLOUDFLARE_ACCOUNT_ID", workflow.split("    steps:", 1)[0])
        final = workflow.index("name: Apply D1 schema, build and deploy through guarded central Ops")
        self.assertLess(workflow.index("name: Revalidate before production credentials"), final)
        self.assertNotIn("secrets.CLOUDFLARE_API_TOKEN", workflow[:final])
        self.assertIn("EXPECTED_HELPER_SHA256:", workflow[final:])
        self.assertIn("EXPECTED_WRAPPER_SHA256:", workflow[final:])

    def test_only_proven_automatic_runs_skip_checks_and_production_build_remains(self):
        workflow = self.workflow()
        for title in ("Audit dependencies", "Run tests"):
            step = workflow.split("- name: " + title, 1)[1].split("- name:", 1)[0]
            self.assertIn("if: steps.proof.outputs.reuse_ci != 'true'", step)
        self.assertIn("Generate production Wrangler config", workflow)
        self.assertIn("npm --prefix client run clean:worker", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("run: npm run deploy:worker", workflow)


if __name__ == "__main__":
    unittest.main(verbosity=2)
