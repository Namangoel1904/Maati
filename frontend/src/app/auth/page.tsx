"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sprout } from "lucide-react";
import { getSession, login, signup } from "@/lib/api";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { getSession().then(({ user, profile }) => { if (user) router.replace(profile ? "/" : "/profile?setup=1"); }).catch(() => {}); }, [router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body = { email: String(data.get("email")), password: String(data.get("password")) };
      const result = mode === "signup" ? await signup({ ...body, username: String(data.get("username")) }) : await login(body);
      router.replace(result.profile ? "/" : "/profile?setup=1");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-[#f6f5eb] p-4 text-[#243b2d]"><section className="w-full max-w-md border-4 border-[#344a36] bg-[#fffdf6] p-6 shadow-[7px_7px_0_#344a36]"><Link href="/" className="flex items-center gap-2 font-mono text-lg font-black tracking-[.2em]"><Sprout/> MAATI</Link><p className="mt-8 font-mono text-[10px] font-bold tracking-[.2em] text-[#74816d]">YOUR OUTSIDE LIFE</p><h1 className="mt-2 text-3xl font-black">{mode === "login" ? "Welcome back" : "Create your account"}</h1><p className="mt-2 text-sm text-[#788373]">Your profile, breaks, posts and scrapbook are saved to your Maati account.</p><form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">{mode === "signup" && <label className="block text-xs font-bold">USERNAME<input name="username" minLength={2} maxLength={30} required autoComplete="username" className="mt-1 w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm font-normal" placeholder="e.g. naman.grows"/></label>}<label className="block text-xs font-bold">EMAIL<input name="email" type="email" required autoComplete="email" className="mt-1 w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm font-normal"/></label><label className="block text-xs font-bold">PASSWORD<input name="password" type="password" required minLength={mode === "signup" ? 6 : 1} autoComplete={mode === "signup" ? "new-password" : "current-password"} className="mt-1 w-full border-2 border-[#b8c3ae] bg-white px-3 py-2 text-sm font-normal"/>{mode === "signup" && <span className="mt-1 block font-normal text-[#788373]">Use at least 6 characters.</span>}</label>{error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}<button disabled={busy} className="w-full border-2 border-[#344a36] bg-[#dce9cd] px-4 py-3 font-mono text-xs font-black tracking-wider shadow-[4px_4px_0_#344a36] disabled:opacity-60">{busy ? "PLEASE WAIT…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}</button></form><button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} className="mt-5 w-full text-sm text-[#647551] underline">{mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button></section></main>;
}
