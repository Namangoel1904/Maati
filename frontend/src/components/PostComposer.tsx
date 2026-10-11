"use client";

import { useState } from "react";
import { ImagePlus, X } from "lucide-react";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this image."));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file: File): Promise<string> {
  const sourceUrl = await readFileAsDataUrl(file);
  const image = new Image();
  image.src = sourceUrl;
  await image.decode();

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the image.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) continue;
    if (blob.size <= MAX_UPLOAD_BYTES) return readFileAsDataUrl(new File([blob], "maati-break.jpg", { type: "image/jpeg" }));
  }
  throw new Error("Could not compress this photo enough. Choose a smaller image.");
}

export default function PostComposer({
  busy = false,
  onSubmit,
  buttonLabel = "POST TO SCRAPBOOK",
  initialCaption = "",
  photoPreviewUrl,
  tone = "retro",
}: {
  busy?: boolean;
  onSubmit(caption: string, photoData: string | null): Promise<void> | void;
  buttonLabel?: string;
  initialCaption?: string;
  photoPreviewUrl?: string;
  tone?: "retro" | "light";
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function selectPhoto(file?: File) {
    setError("");
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError("Choose a JPG, PNG, or WebP image."); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError("Image must be 4 MB or smaller."); return; }
    setProcessingPhoto(true);
    try { setPhotoData(await preparePhoto(file)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not prepare this image."); }
    finally { setProcessingPhoto(false); }
  }

  const light = tone === "light";
  return <div className={`space-y-3 rounded-2xl border p-3 sm:p-4 ${light ? "border-[#dce5d8] bg-[#f8faf6] text-[#314637]" : "border-green-800 bg-black/70 text-green-200"}`}>
    <label className="block text-[10px] font-bold uppercase tracking-wide">Add a caption<textarea value={caption} onChange={e => setCaption(e.target.value)} maxLength={500} rows={2} placeholder="A little note about your break…" className={`mt-1.5 w-full resize-y rounded-xl border px-3 py-2 text-sm font-normal normal-case outline-none transition focus:ring-2 ${light ? "border-[#d5dfd1] bg-white text-[#263b2e] placeholder:text-[#93a093] focus:border-[#78946f] focus:ring-[#dce9d5]" : "border-gray-700 bg-gray-950 text-green-100 placeholder:text-gray-600 focus:ring-green-900"}`}/></label>
    <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${light ? "border-[#d7e1d2] bg-white text-[#45634a] hover:bg-[#f1f6ed]" : "border-gray-700 hover:bg-gray-900"} ${processingPhoto ? "pointer-events-none opacity-50" : ""}`}><ImagePlus size={14}/>{processingPhoto ? "Preparing photo…" : photoData ? "Change photo" : "Add a photo (optional)"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy || processingPhoto} onChange={e => { void selectPhoto(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}/></label>
    {(photoData || photoPreviewUrl) && <div className="relative"><img src={photoData || photoPreviewUrl} alt="Post preview" className="max-h-36 w-full object-cover"/>{photoData && <button type="button" aria-label="Remove photo" onClick={() => setPhotoData(null)} className="absolute right-1 top-1 border border-white/40 bg-black/80 p-1"><X size={12}/></button>}</div>}
    {error && <p role="alert" className="text-[9px] text-red-300">{error}</p>}
    <button type="button" disabled={busy || processingPhoto || submitting} onClick={async () => { setError(""); setSubmitting(true); try { await onSubmit(caption.trim(), photoData); } catch (e) { setError(e instanceof Error ? e.message : "Could not save the post."); } finally { setSubmitting(false); } }} className={`w-full rounded-xl border px-3 py-2.5 text-xs font-extrabold uppercase tracking-wide transition disabled:opacity-50 ${light ? "border-[#31583a] bg-[#31583a] text-white hover:bg-[#24482f]" : "border-2 border-green-700 bg-green-950 text-green-100"}`}>{busy || submitting ? "SAVING…" : processingPhoto ? "PREPARING PHOTO…" : buttonLabel}</button>
  </div>;
}
