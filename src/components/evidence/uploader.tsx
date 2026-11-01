'use client';

// The evidence field (milestone M10a, In scope 2; plan §5.8): a plain `<input type="file">` that
// accepts JPEG, PNG, WebP and PDF and works in a phone's browser and a mobile webview (the system
// picker: files, photos, the camera); dropping files on the field is only an addition for a
// desktop. Each chosen file is sent on its own to POST /api/evidence/upload, the file itself as the
// body (src/server/evidence-http.ts), and the server checks everything again: the size before the
// body is read, the type by its magic bytes, the images re-encoded without EXIF and GPS. The 20 MB
// check here only spares a long wait (DEFAULT D25).
//
// Two uses: files for a claim not sent yet (no `caseId`: each uploaded file becomes a hidden
// `evidenceIds` field of the surrounding form, and "Remove" discards it through evidence.discard),
// and more files for an open claim (`caseId`: each file joins the claim at once and the page is
// refreshed; a file in a claim stays with it). A polite live region says what happened to each
// file; the list says it too, in text, never by colour alone.

import { useRouter } from 'next/navigation';
import { type DragEvent, useId, useRef, useState } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';

export const EVIDENCE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_MB = 20;
const MAX_BYTES = MAX_MB * 1024 * 1024;

export interface UploadedEvidenceItem {
  id: string;
  name: string;
  kindLabel: string;
  sizeBytes: number;
}

interface Item {
  key: string;
  name: string;
  state: 'uploading' | 'done' | 'refused';
  message?: string;
  file?: UploadedEvidenceItem;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

type Discard = (id: string) => Promise<{ ok: boolean; message?: string }>;

export function EvidenceUploader({
  label,
  hint,
  caseId,
  initial = [],
  discard,
  error,
  maxFiles = 20,
  name = 'evidenceIds',
}: {
  label: string;
  hint: string;
  /** An open claim of the account's: files join it at once. */
  caseId?: string;
  /** Files uploaded before a refused submit (their ids came back in the form's values). */
  initial?: UploadedEvidenceItem[];
  /** Removes an uploaded file that is in no claim yet (evidence.discard). */
  discard?: Discard;
  /** The field's error from the server (`evidenceIds`). */
  error?: string;
  maxFiles?: number;
  name?: string;
}) {
  const id = useId();
  const inputId = `${id}-file`;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>(() => initial.map((file) => ({ key: file.id, name: file.name, state: 'done', file })));
  const [announce, setAnnounce] = useState('');
  const [over, setOver] = useState(false);
  const busy = items.some((item) => item.state === 'uploading');
  const uploaded = items.filter((item) => item.state === 'done').length;

  const update = (key: string, change: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  async function send(file: File, key: string): Promise<void> {
    if (file.size > MAX_BYTES) {
      update(key, { state: 'refused', message: `Larger than ${MAX_MB} MB: not uploaded. Upload a smaller copy, or split the document.` });
      setAnnounce(`${file.name}: larger than ${MAX_MB} MB, not uploaded.`);
      return;
    }
    try {
      const response = await fetch(`/api/evidence/upload${caseId ? `?case=${encodeURIComponent(caseId)}` : ''}`, {
        method: 'POST',
        body: file,
        credentials: 'same-origin',
        headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
      });
      const body = (await response.json().catch(() => null)) as { evidence?: { id: string; kindLabel: string; sizeBytes: number; name: string | null }; message?: string } | null;
      if (!response.ok || !body?.evidence) {
        const message = body?.message ?? 'The file could not be uploaded. Try again.';
        update(key, { state: 'refused', message });
        setAnnounce(`${file.name}: ${message}`);
        return;
      }
      const { evidence } = body;
      update(key, { state: 'done', file: { id: evidence.id, name: evidence.name ?? file.name, kindLabel: evidence.kindLabel, sizeBytes: evidence.sizeBytes } });
      setAnnounce(`${file.name}: uploaded.`);
    } catch {
      update(key, { state: 'refused', message: 'The connection failed: not uploaded. Try again.' });
      setAnnounce(`${file.name}: the connection failed, not uploaded.`);
    }
  }

  async function take(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    const room = maxFiles - uploaded;
    const chosen = list.slice(0, Math.max(room, 0));
    const fresh = chosen.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, name: file.name, state: 'uploading' as const }));
    const extra = list.slice(chosen.length).map((file, i) => ({
      key: `${Date.now()}-x${i}-${file.name}`,
      name: file.name,
      state: 'refused' as const,
      message: `Not uploaded: a claim has at most ${maxFiles} files.`,
    }));
    setItems((current) => [...current, ...fresh, ...extra]);
    setAnnounce(`Uploading ${chosen.length === 1 ? '1 file' : `${chosen.length} files`}…`);
    // One at a time: the server reads each file whole, and a phone's connection is shared.
    for (const [i, file] of chosen.entries()) await send(file, fresh[i]!.key);
    if (input.current) input.current.value = '';
    if (caseId) router.refresh();
  }

  async function remove(item: Item) {
    if (!item.file) {
      setItems((current) => current.filter((other) => other.key !== item.key));
      return;
    }
    if (discard) {
      const result = await discard(item.file.id);
      if (!result.ok) {
        setAnnounce(result.message ?? 'The file could not be removed. Try again.');
        return;
      }
    }
    setItems((current) => current.filter((other) => other.key !== item.key));
    setAnnounce(`${item.name}: removed.`);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length > 0) void take(event.dataTransfer.files);
  }

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div data-field="" className="grid gap-3" data-testid="evidence-uploader">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx('grid gap-2 rounded-sm border border-dashed p-4', over ? 'border-fg bg-surface-2' : 'border-border-strong', error && 'border-danger')}
      >
        <label htmlFor={inputId} className="text-sm font-semibold">
          {label}
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={EVIDENCE_ACCEPT}
          disabled={busy}
          onChange={(event) => void take(event.currentTarget.files ?? [])}
          aria-describedby={cx(hintId, error && errorId) || undefined}
          aria-invalid={error ? true : undefined}
          data-testid="evidence-input"
          className={cx(
            'block min-h-11 w-full text-ui text-fg file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-sm file:border file:border-border-strong',
            'file:bg-surface-1 file:px-4 file:font-semibold file:text-fg',
          )}
        />
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
        {error ? (
          <p id={errorId} className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul className="grid gap-2" data-testid="evidence-list" aria-label="Files">
          {items.map((item) => (
            <li key={item.key} data-testid="evidence-item" data-state={item.state} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm bg-surface-2 px-3 py-2">
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold break-words" translate="no">
                  {item.name}
                </span>
                <span className="text-sm text-fg-muted">
                  {item.state === 'uploading'
                    ? 'Uploading…'
                    : item.state === 'refused'
                      ? item.message
                      : `Uploaded · ${item.file!.kindLabel} · ${formatSize(item.file!.sizeBytes)}`}
                </span>
              </span>
              {item.state === 'done' && !caseId ? (
                <>
                  <input type="hidden" name={name} value={item.file!.id} />
                  {/* Shown again after a refused submit (the action keeps them in the form's values). */}
                  <input type="hidden" name={`evidenceName.${item.file!.id}`} value={item.file!.name} />
                  <input type="hidden" name={`evidenceKind.${item.file!.id}`} value={item.file!.kindLabel} />
                  <input type="hidden" name={`evidenceSize.${item.file!.id}`} value={String(item.file!.sizeBytes)} />
                </>
              ) : null}
              {item.state !== 'uploading' && !(caseId && item.state === 'done') ? (
                <button type="button" onClick={() => void remove(item)} className={cx(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-h-11')}>
                  Remove<span className="sr-only"> {item.name}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
