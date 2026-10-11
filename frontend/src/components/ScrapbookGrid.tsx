"use client";

import { motion } from "framer-motion";
import { Footprints, MapPinned, Sprout } from "lucide-react";

export interface ScrapbookStats {
  streak: number;
  seedsPlanted: number;
  citiesExplored: number;
}

export interface ScrapbookBadge {
  id: string;
  title: string;
  condition: string;
  unlockedAt: string;
  pixel: string;
  tone: string;
}

const statIcons = [Sprout, Footprints, MapPinned];

export default function ScrapbookGrid({
  stats,
  badges,
}: {
  stats: ScrapbookStats;
  badges: ScrapbookBadge[];
}) {
  const values = [stats.streak, stats.seedsPlanted, stats.citiesExplored];
  const labels = ["DAY STREAK", "SEEDS PLANTED", "CITIES EXPLORED"];

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="mb-7">
        <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-[#74816d]">YOUR LITTLE ARCHIVE</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-[#294130] sm:text-4xl">My Scrapbook</h1>
        <p className="mt-2 text-sm text-[#788373]">Every small step outside counts as a story.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {values.map((value, index) => {
          const Icon = statIcons[index];
          return (
            <div key={labels[index]} className="flex items-center gap-4 border-2 border-[#344a36] bg-[#fffdf6] p-4 shadow-[4px_4px_0_#344a36] sm:p-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center border-2 border-dashed border-[#8b9a72] bg-[#edf3df] text-[#58714e]">
                <Icon size={21} />
              </span>
              <div>
                <p className="font-mono text-2xl font-black text-[#2c4733]">{value}</p>
                <p className="mt-1 font-mono text-[9px] font-bold tracking-widest text-[#7c8675]">{labels[index]}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-bold tracking-[0.2em] text-[#74816d]">PIXEL KEEPSAKES</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-[#294130]">Collected badges</h2>
        </div>
        <p className="font-mono text-[10px] text-[#879080]">HOVER OR FOCUS TO READ THE STORY</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {badges.map((badge, index) => (
          <motion.article
            key={badge.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            tabIndex={0}
            className="group relative border-2 border-[#344a36] bg-[#fffdf6] p-3 shadow-[4px_4px_0_#344a36] outline-none transition hover:-translate-y-1 hover:shadow-[5px_7px_0_#344a36] focus-visible:ring-4 focus-visible:ring-[#c2d4a9] sm:p-4"
            aria-label={`${badge.title}. ${badge.condition} Unlocked ${badge.unlockedAt}.`}
          >
            <div className={`relative grid aspect-square place-items-center border-2 border-dashed border-[#859273] ${badge.tone}`}>
              <span className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(39,62,46,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(39,62,46,.5)_1px,transparent_1px)] [background-size:8px_8px]" />
              <span className="relative text-5xl [image-rendering:pixelated] sm:text-6xl">{badge.pixel}</span>
              <span className="absolute bottom-2 right-2 font-mono text-[8px] font-black opacity-60">★</span>
            </div>
            <h3 className="mt-3 truncate font-mono text-[10px] font-black text-[#354b37] sm:text-xs">{badge.id}</h3>
            <p className="mt-1 truncate text-xs font-semibold text-[#758070]">{badge.title}</p>
            <div className="pointer-events-none absolute inset-x-2 bottom-[calc(100%-0.5rem)] z-20 translate-y-2 border-2 border-[#293e2e] bg-[#fff8d9] p-3 font-mono text-[10px] leading-relaxed text-[#48533e] opacity-0 shadow-[4px_4px_0_#293e2e] transition group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100">
              <p className="font-black">{badge.title}</p>
              <p className="mt-1">{badge.condition}</p>
              <p className="mt-2 text-[#81733f]">Unlocked: {badge.unlockedAt}</p>
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
