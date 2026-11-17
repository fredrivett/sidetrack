"use client";

import { useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { setAvatarUrlAction, uploadAvatarAction } from "@/app/actions";
import { isUploadedAvatar } from "@/lib/avatar";
import { normalizeWebUrl } from "@/lib/url";

// Uploads are cropped to a centred square this many pixels wide before they
// leave the browser: avatars show at 40px at most, and it keeps each stored
// image to tens of KB whatever the camera produced.
const UPLOAD_SIZE = 256;

/** Crop an image file to a centred square and re-encode it small. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(UPLOAD_SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  // Browsers without a WebP encoder hand back PNG instead; both are accepted.
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      "image/webp",
      0.9,
    ),
  );
}

/**
 * Set or clear the user's avatar: upload an image, or paste an http(s) image
 * URL. Either way it lands in the Better Auth user's `image` (an upload as its
 * /api/avatars path). The server validates both; the preview is UserAvatar,
 * so it shows exactly what others will see, initials included.
 */
export function AvatarPanel({ user }: { user: AvatarUser }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const uploaded = isUploadedAvatar(user.userId, user.image);
  // The URL field holds a pasted URL; an uploaded image has none to show.
  const initial = uploaded ? "" : (user.image ?? "");
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<string | null>, message: string) {
    setError(null);
    startTransition(async () => {
      const failure = await work();
      if (failure) {
        setError(failure);
        return;
      }
      toast.success(message);
      router.refresh();
    });
  }

  function saveUrl(image: string | null, message: string) {
    run(async () => {
      try {
        await setAvatarUrlAction(image);
      } catch (e) {
        // A signed-out session rejects with Next's redirect to /login.
        unstable_rethrow(e);
        return "Couldn't update avatar.";
      }
      setValue(image ?? "");
      return null;
    }, message);
  }

  function upload(file: File) {
    run(async () => {
      let blob: Blob;
      try {
        blob = await shrinkImage(file);
      } catch {
        // Not an image the browser can decode, whatever its file type says.
        return "Couldn't read that image. Try a PNG or JPEG.";
      }
      const form = new FormData();
      form.append("file", blob);
      try {
        await uploadAvatarAction(form);
      } catch (e) {
        unstable_rethrow(e);
        return "Couldn't upload that image.";
      }
      setValue("");
      return null;
    }, "Avatar updated");
  }

  const trimmed = value.trim();
  // Preview what the server will store: a bare host ("example.com/me.png")
  // gains https://, so the <img> doesn't resolve it relative to this page.
  let preview: string | null = null;
  try {
    preview = normalizeWebUrl(trimmed, "avatar URL");
  } catch {
    // Not a valid URL yet: preview initials; Save reports it.
  }
  // An empty field over an uploaded image keeps the upload.
  const shown = trimmed ? preview : uploaded ? user.image : null;

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <span className="block text-sm font-medium">Avatar</span>
      <div className="flex items-center gap-3">
        <UserAvatar user={{ ...user, image: shown }} size={40} />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so choosing the same file again still fires
            if (file) upload(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={pending}
        >
          Upload image
        </Button>
        {user.image && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => saveUrl(null, "Avatar removed")}
            disabled={pending}
          >
            Remove
          </Button>
        )}
      </div>
      <label htmlFor="avatar" className="block text-xs text-muted-foreground">
        Or paste an image URL
      </label>
      <div className="flex gap-2">
        <Input
          id="avatar"
          name="avatar"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button
          type="button"
          onClick={() =>
            preview
              ? saveUrl(preview, "Avatar updated")
              : setError("Avatar must be an http(s) image URL.")
          }
          disabled={pending || !trimmed || preview === initial}
        >
          <Check data-icon="inline-start" />
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown next to items assigned to you. Remove it to show your initials.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
