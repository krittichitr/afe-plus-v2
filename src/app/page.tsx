import Link from "next/link";

export default function Home() {
  return (
    <main className={''}>
      HomePage DemoAssist SmartWatch rn
      <Link href="/navigation">Navigation</Link>
      <Link href="/location">Location</Link>
    </main>
  )
}
