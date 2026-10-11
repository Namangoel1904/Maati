"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BookHeart, LogOut, Sprout, UserRound } from "lucide-react";
import SocialFeed, { type CommunityPost } from "@/components/SocialFeed";
import { getFeed, getSession, logout, toggleReaction, updatePost, type User } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  function openBreakCompanion() {
    const bridge = (window as Window & { maatiWidget?: { focusBreakCompanion(): Promise<void> } }).maatiWidget;
    if (bridge) void bridge.focusBreakCompanion();
    else router.push("/widget");
  }

  const refresh = useCallback(async () => {
    const session = await getSession();
    if (!session.user) { router.replace("/auth"); return; }
    if (!session.profile) { router.replace("/profile?setup=1"); return; }
    setUser(session.user);
    setPosts((await getFeed()).posts);
  }, [router]);

  useEffect(() => { refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not load your community feed.")).finally(() => setLoading(false)); }, [refresh]);
  async function react(postId: string, reaction: "sprouted" | "touched_grass") {
    const result = await toggleReaction(postId, reaction);
    setPosts((current) => current.map((post) => post.id === postId ? { ...post, reactions: result.reactions, myReactions: { ...post.myReactions, [reaction === "sprouted" ? "sprouted" : "touchedGrass"]: result.active } } : post));
  }
  async function editPost(postId: string, caption: string, photoData: string | null) {
    await updatePost(postId, { caption, photoData });
    setPosts((await getFeed()).posts);
  }
  async function signOut() { await logout(); router.replace("/auth"); }

  return <main className="min-h-screen bg-[#f6f5eb] text-[#243b2d]"><header className="sticky top-0 z-30 border-b-2 border-[#344a36] bg-[#fbfaf2]/95 backdrop-blur"><div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 sm:px-7 lg:px-10"><Link href="/" className="flex shrink-0 items-center gap-2.5"><span className="grid h-9 w-9 place-items-center border-2 border-[#344a36] bg-[#e5efd7] text-[#496742] shadow-[2px_2px_0_#344a36]"><Sprout size={19}/></span><span className="font-mono text-lg font-black tracking-[0.2em]">MAATI</span></Link><nav className="flex h-full items-center gap-2"><span className="border-b-4 border-[#c9dcae] px-3 py-3 text-xs font-bold">Community Feed</span><Link href="/profile" className="px-3 py-3 text-xs font-bold text-[#788373] hover:text-[#344a36]">My Scrapbook</Link></nav><div className="flex items-center gap-2"><button onClick={openBreakCompanion} className="flex h-10 items-center gap-2 border-2 border-[#344a36] bg-[#e5efd7] px-3 font-mono text-[10px] font-black text-[#344a36] shadow-[3px_3px_0_#344a36]"><span>+ POST BREAK</span><ArrowUpRight size={13}/></button><Link aria-label="Profile" href="/profile" className="grid h-9 w-9 place-items-center border-2 border-[#344a36] bg-white"><UserRound size={16}/></Link><button title={`Sign out ${user?.username || ""}`} onClick={() => void signOut()} className="grid h-9 w-9 place-items-center text-[#788373] hover:text-red-700"><LogOut size={16}/></button></div></div></header>
    <div className="mx-auto min-h-[75vh] max-w-7xl px-4 py-8 sm:px-7 lg:px-10">{loading ? <p className="mx-auto max-w-3xl animate-pulse py-20 text-center font-mono text-xs text-[#788373]">LOADING YOUR COMMUNITY…</p> : error ? <p role="alert" className="mx-auto max-w-3xl border-2 border-red-300 bg-white p-5 text-sm text-red-800">{error}</p> : <SocialFeed posts={posts} onReact={react} onEdit={editPost}/>}<div className="mx-auto mt-12 flex max-w-5xl items-center justify-center gap-2 border-t border-dashed border-[#cbd3c1] py-6 font-mono text-[9px] tracking-widest text-[#899184]"><BookHeart size={13}/> YOUR OUTSIDE LIFE, ONE LITTLE LOG AT A TIME</div></div>
  </main>;
}
