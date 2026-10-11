"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Award, Clock3, Footprints, MapPin, Pencil, Sprout, X } from "lucide-react";
import type { FeedPost } from "@/lib/api";
import PostComposer from "@/components/PostComposer";

export type CommunityPost = FeedPost;

const photoStyles = {
  leaf: "from-[#24573b] via-[#6e9658] to-[#c6a85e]",
  sunset: "from-[#4c2b43] via-[#b85d50] to-[#e0a45c]",
  sky: "from-[#1d5960] via-[#6e9e97] to-[#d4c38e]",
  earth: "from-[#624633] via-[#a77b52] to-[#63784b]",
};

const avatarStyles = ["bg-[#315d44]", "bg-[#76513e]", "bg-[#315f69]", "bg-[#6b4e73]"];

function FeedCard({ post, index, onReact, onEdit }: {
  post: FeedPost;
  index: number;
  onReact: (id: string, reaction: "sprouted" | "touched_grass") => Promise<void>;
  onEdit: (id: string, caption: string, photoData: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function react(reaction: "sprouted" | "touched_grass") {
    if (busy) return;
    setBusy(true);
    try { await onReact(post.id, reaction); } finally { setBusy(false); }
  }

  return <motion.article
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: .3, delay: Math.min(index * .05, .2) }}
    className="overflow-hidden rounded-3xl border border-[#dce3d7] bg-white shadow-[0_12px_36px_-25px_rgba(31,55,39,.45)] transition-shadow hover:shadow-[0_18px_42px_-24px_rgba(31,55,39,.48)]"
  >
    <header className="flex items-center gap-3.5 px-4 py-4 sm:px-6">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xs font-black text-white ring-4 ring-[#f3f5ef] ${avatarStyles[index % avatarStyles.length]}`} aria-hidden="true">{post.initials}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold tracking-tight text-[#203a2b]">{post.username}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[#637467]">
          <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-[#52734e]"/>{post.city}</span>
          <span className="text-[#b3bdb1]">·</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={11}/>{post.timeLabel}</span>
        </p>
      </div>
      {post.isMine && <button onClick={() => setEditing(value => !value)} aria-label={editing ? "Close post editor" : "Edit caption or photo"} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#e1e8df] text-[#65756a] transition hover:border-[#8ba27e] hover:bg-[#f1f6ed] hover:text-[#294a35]">
        {editing ? <X size={15}/> : <Pencil size={14}/>}
      </button>}
    </header>

    <div className={`relative isolate grid aspect-[4/3] place-items-center overflow-hidden bg-gradient-to-br ${photoStyles[post.photoTone]}`}>
      {post.photoUrl ? <img src={post.photoUrl} alt={post.caption || post.photoLabel} className="absolute inset-0 -z-10 h-full w-full object-cover"/> : <>
        <div className="absolute inset-0 -z-10 opacity-[.17] [background-image:linear-gradient(rgba(255,255,255,.75)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.75)_1px,transparent_1px)] [background-size:28px_28px]"/>
        <div className="absolute -right-12 -top-16 -z-10 h-64 w-64 rounded-full border border-white/20"/>
        <div className="absolute -bottom-28 -left-16 -z-10 h-72 w-72 rounded-full border border-white/20"/>
        <div className="relative flex flex-col items-center gap-3 text-center text-white drop-shadow-[0_4px_12px_rgba(0,0,0,.25)]">
          <span className="text-8xl leading-none sm:text-9xl">{post.photoEmoji}</span>
          <span className="rounded-full border border-white/45 bg-black/15 px-3 py-1 font-mono text-[9px] font-bold tracking-[.18em]">A MOMENT OUTSIDE</span>
        </div>
      </>}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/65 via-black/15 to-transparent px-4 pb-4 pt-16 sm:px-5">
        <span className="rounded-full border border-white/35 bg-[#14281f]/75 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white backdrop-blur-sm">{post.photoLabel}</span>
        <span className="font-mono text-[9px] font-bold tracking-[.16em] text-white/85">FIELD NOTE {String(index + 1).padStart(2, "0")}</span>
      </div>
    </div>

    <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
      <p className="text-[15px] font-medium leading-6 text-[#263b2e]">{post.caption || post.mission}</p>
      {post.caption && <p className="mt-2.5 flex gap-2 text-xs leading-5 text-[#64766a]"><Footprints size={14} className="mt-0.5 shrink-0 text-[#718a61]"/><span><b className="font-bold text-[#465c4a]">BREAK</b> · {post.mission}</span></p>}

      {editing && <div className="mt-4"><PostComposer
        tone="light"
        busy={busy}
        initialCaption={post.caption}
        photoPreviewUrl={post.photoUrl || undefined}
        buttonLabel="SAVE POST CHANGES"
        onSubmit={async (caption, photoData) => {
          setBusy(true);
          try { await onEdit(post.id, caption, photoData); setEditing(false); }
          finally { setBusy(false); }
        }}
      /></div>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0e9] pt-4">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#fbf4df] px-3 py-1.5 text-[10px] font-bold text-[#76602b]">
          <Award size={13} className="shrink-0"/><span className="truncate">{post.badgeId.replaceAll("_", " ")}</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <motion.button whileTap={{ scale: .96 }} disabled={busy} type="button" aria-pressed={post.myReactions.sprouted} onClick={() => void react("sprouted")} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${post.myReactions.sprouted ? "border-[#528050] bg-[#e4f0df] text-[#31583a]" : "border-[#e2e9df] bg-white text-[#53675a] hover:border-[#9bb48e] hover:bg-[#f3f7ef]"}`}>
            <Sprout size={14}/><span>Sprouted</span><span className="rounded-md bg-black/[.045] px-1.5 py-0.5 text-[10px] tabular-nums">{post.reactions.sprouted}</span>
          </motion.button>
          <motion.button whileTap={{ scale: .96 }} disabled={busy} type="button" aria-pressed={post.myReactions.touchedGrass} onClick={() => void react("touched_grass")} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${post.myReactions.touchedGrass ? "border-[#528050] bg-[#e4f0df] text-[#31583a]" : "border-[#e2e9df] bg-white text-[#53675a] hover:border-[#9bb48e] hover:bg-[#f3f7ef]"}`}>
            <span aria-hidden="true">🌿</span><span>Touched grass</span><span className="rounded-md bg-black/[.045] px-1.5 py-0.5 text-[10px] tabular-nums">{post.reactions.touchedGrass}</span>
          </motion.button>
        </div>
      </div>
    </div>
  </motion.article>;
}

export default function SocialFeed({ posts, onReact, onEdit }: {
  posts: FeedPost[];
  onReact: (id: string, reaction: "sprouted" | "touched_grass") => Promise<void>;
  onEdit: (id: string, caption: string, photoData: string | null) => Promise<void>;
}) {
  return <section className="mx-auto w-full max-w-3xl">
    <div className="relative mb-7 overflow-hidden rounded-3xl bg-[#193d2e] px-5 py-6 text-white shadow-[0_16px_40px_-22px_rgba(23,54,39,.55)] sm:px-8 sm:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.1] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:24px_24px]"/>
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border border-white/15 sm:right-10 sm:top-[-8rem]"/>
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="inline-flex items-center gap-2 font-mono text-[9px] font-bold tracking-[.2em] text-[#c4d8ae]"><Sprout size={13}/> THE OUTSIDE LOG</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-[2.6rem]">Good breaks grow here.</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-[#d0ddd1]">Small moments away from the screen, shared by people in your community.</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/[.08] px-4 py-3 backdrop-blur-sm">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#cfe1b7] text-[#315638]"><Footprints size={17}/></span>
          <div><p className="font-mono text-xl font-black leading-none tabular-nums">{posts.length}</p><p className="mt-1 text-[9px] font-bold tracking-[.13em] text-[#d0ddd1]">SHARED BREAKS</p></div>
        </div>
      </div>
    </div>

    {posts.length ? <div className="space-y-6">{posts.map((post, index) => <FeedCard key={post.id} post={post} index={index} onReact={onReact} onEdit={onEdit}/>)}</div> : <div className="rounded-3xl border border-dashed border-[#b8c7b5] bg-white px-6 py-12 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#edf4e8] text-[#52734e]"><Sprout size={25}/></span>
      <h2 className="mt-4 text-lg font-extrabold text-[#294333]">Your community starts with one break</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#64766a]">Accept a mission, step away for a little while, and share a field note when you return.</p>
    </div>}
  </section>;
}
