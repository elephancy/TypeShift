import Link from "next/link";

interface BrandLogoProps {
  href?: string;
}

export default function BrandLogo({ href = "/" }: BrandLogoProps) {
  return (
    <Link href={href} className="brand-mark" aria-label="TypeShift home">
      <img className="brand-logo" src="/favicon.ico" alt="" width={44} height={44} aria-hidden="true" />
      <span className="brand-copy">
        <span className="brand-text">TypeShift</span>
        <span className="brand-sub sr-only">arcade typing drills</span>
      </span>
    </Link>
  );
}
