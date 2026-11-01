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
// refreshed; a file in a claim stays with it, and once the page lists it the field does not list
// it again: M10a review, screens-8).
//
// What happened is said in text, never by colour alone: each row says "Uploading…", "Uploaded" or
// "Not uploaded" with its reason (a refused row also has the alert icon and a thick danger edge:
// screens-9). A polite log reads out every file's outcome and, after several files, a summary;
// each line is added, never replaced, so none is lost (screens-4). The focus never falls to the
// page: the field stays focusable while files upload (aria-disabled, the picker held back), and
// after "Remove" it moves to the next file's Remove, else the previous one's, else the field
// (screens-2).

import { useRouter } from 'next/navigation';
import { type DragEvent, type MouseEvent, useId, useRef, useState } from 'react';

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatSize } from '@/lib/file-size';

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
  /** Why a refused file was not uploaded. */
  message?: string;
  file?: UploadedEvidenceItem;
}

type Discard = (id: string) => Promise<{ ok: boolean; message?: string }>;

const countFiles = (n: number) => (n === 1 ? '1 file' : `${n} files`);
const STILL_UPLOADING = 'Files are still uploading. Add more when they are done.';

export function EvidenceUploader({
  label,
  hint,
  caseId,
  initial = [],
  knownIds = [],
  discard,
  error,
  inputId: givenInputId,
  maxFiles = 20,
  name = 'evidenceIds',
}: {
  label: string;
  hint: string;
  /** An open claim of the account's: files join it at once. */
  caseId?: string;
  /** Files uploaded before a refused submit (their ids came back in the form's values). */
  initial?: UploadedEvidenceItem[];
  /** With `caseId`: the ids of the files the page already lists with the claim. */
  knownIds?: readonly string[];
  /** Removes an uploaded file that is in no claim yet (evidence.discard). */
  discard?: Discard;
  /** The field's error from the server (`evidenceIds`). */
  error?: string;
  /** The file input's id: the form's fieldId(form, 'evidenceIds'), which its error summary links to (screens-3). */
  inputId?: string;
  maxFiles?: number;
  name?: string;
}) {
  const id = useId();
  const inputId = givenInputId ?? `${id}-file`;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const lineId = useRef(0);
  const batchId = useRef(0);
  const [items, setItems] = useState<Item[]>(() => initial.map((file) => ({ key: file.id, name: file.name, state: 'done', file })));
  const [log, setLog] = useState<{ id: number; text: string }[]>([]);
  const [over, setOver] = useState(false);
  const busy = items.some((item) => item.state === 'uploading');
  const uploaded = items.filter((item) => item.state === 'done').length;
  // In a claim, a file the page lists already (after the refresh) is not listed here again.
  const shown = caseId ? items.filter((item) => !(item.state === 'done' && item.file && knownIds.includes(item.file.id))) : items;
  const added = caseId ? 'added to the claim' : 'uploaded';

  /** Adds a line to the log; `fresh` starts it again (a new batch, a removal). */
  function say(text: string, fresh = false) {
    lineId.current += 1;
    const line = { id: lineId.current, text };
    setLog((current) => (fresh ? [line] : [...current, line]));
  }

  const update = (key: string, change: Partial<Item>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  /** Uploads one file; true when it was uploaded. */
  async function send(file: File, key: string): Promise<boolean> {
    const refuse = (message: string) => {
      update(key, { state: 'refused', message });
      say(`${file.name}: not uploaded. ${message}`);
      return false;
    };
    if (file.size > MAX_BYTES) return refuse(`Larger than ${MAX_MB} MB. Upload a smaller copy, or split the document.`);
    try {
      const response = await fetch(`/api/evidence/upload${caseId ? `?case=${encodeURIComponent(caseId)}` : ''}`, {
        method: 'POST',
        body: file,
        credentials: 'same-origin',
        headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'application/octet-stream' },
      });
      const body = (await response.json().catch(() => null)) as { evidence?: { id: string; kindLabel: string; sizeBytes: number; name: string | null }; message?: string } | null;
      if (!response.ok || !body?.evidence) return refuse(body?.message ?? 'The file could not be uploaded. Try again.');
      const { evidence } = body;
      update(key, { state: 'done', file: { id: evidence.id, name: evidence.name ?? file.name, kindLabel: evidence.kindLabel, sizeBytes: evidence.sizeBytes } });
      say(`${file.name}: ${added}.`);
      return true;
    } catch {
      return refuse('The connection failed. Try again.');
    }
  }

  async function take(chosenFiles: FileList | File[]) {
    const all = [...chosenFiles];
    if (all.length === 0) return;
    const room = maxFiles - uploaded;
    const chosen = all.slice(0, Math.max(room, 0));
    batchId.current += 1;
    const stamp = `b${batchId.current}`;
    const fresh = chosen.map((file, i) => ({ key: `${stamp}-${i}-${file.name}`, name: file.name, state: 'uploading' as const }));
    const limit = `A claim has at most ${maxFiles} files.`;
    const extra = all.slice(chosen.length).map((file, i) => ({ key: `${stamp}-x${i}-${file.name}`, name: file.name, state: 'refused' as const, message: limit }));
    setItems((current) => [...current, ...fresh, ...extra]);
    say(chosen.length > 0 ? `Uploading ${countFiles(chosen.length)}…` : `Not uploaded: ${limit}`, true);
    // One at a time: the server reads each file whole, and a phone's connection is shared.
    const refused: string[] = [];
    for (const [i, file] of chosen.entries()) if (!(await send(file, fresh[i]!.key))) refused.push(file.name);
    for (const item of extra) {
      say(`${item.name}: not uploaded. ${limit}`);
      refused.push(item.name);
    }
    if (input.current) input.current.value = '';
    if (all.length > 1) {
      say(`${all.length - refused.length} of ${countFiles(all.length)} ${added}.${refused.length > 0 ? ` Not uploaded: ${refused.join(', ')}.` : ''}`);
    }
    if (caseId && refused.length < all.length) router.refresh();
  }

  /**
   * Removes a file from the list (an uploaded one through `discard`), says so, and moves the focus
   * to the next file's Remove, else the previous one's, else the file field: never to the page.
   */
  async function remove(item: Item, button: HTMLButtonElement) {
    if (item.file && discard) {
      const result = await discard(item.file.id);
      if (!result.ok) {
        say(result.message ?? 'The file could not be removed. Try again.', true);
        return;
      }
    }
    const active = document.activeElement;
    if (active === button || active === document.body || active === null) {
      const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]') ?? [])];
      const at = buttons.indexOf(button);
      (buttons[at + 1] ?? buttons[at - 1] ?? input.current)?.focus();
    }
    setItems((current) => current.filter((other) => other.key !== item.key));
    say(`${item.name}: removed.`, true);
  }

  function onPick(event: MouseEvent<HTMLInputElement>) {
    // While files upload the field keeps the focus (a disabled field would drop it to the page)
    // but holds the picker back.
    if (!busy) return;
    event.preventDefault();
    say(STILL_UPLOADING);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    if (busy) {
      say(STILL_UPLOADING);
      return;
    }
    if (event.dataTransfer.files.length > 0) void take(event.dataTransfer.files);
  }

  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
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
          aria-disabled={busy || undefined}
          onClick={onPick}
          onChange={(event) => void take(event.currentTarget.files ?? [])}
          aria-describedby={cx(hintId, error && errorId) || undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          data-testid="evidence-input"
          className={cx(
            'block min-h-11 w-full text-ui text-fg file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-sm file:border file:border-border-strong',
            'file:bg-surface-1 file:px-4 file:font-semibold file:text-fg aria-disabled:file:cursor-wait aria-disabled:file:text-fg-muted',
          )}
        />
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
            <AlertIcon size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
      {shown.length > 0 ? (
        <ul ref={list} className="grid gap-2" data-testid="evidence-list" aria-label="Files">
          {shown.map((item) => (
            <li
              key={item.key}
              data-testid="evidence-item"
              data-state={item.state}
              // A border of its own, so the row is a box on a raised card too (screens-8).
              className={cx(
                'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm border bg-surface-2 px-3 py-2',
                item.state === 'refused' ? 'border-l-4 border-danger' : 'border-border-subtle',
              )}
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="font-semibold break-words" translate="no">
                  {item.name}
                </span>
                {item.state === 'refused' ? (
                  <span className="flex items-start gap-1.5 text-sm text-danger" data-testid="evidence-refusal">
                    <AlertIcon size={16} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="font-semibold">Not uploaded:</span> {item.message}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-fg-muted">
                    {item.state === 'uploading' ? 'Uploading…' : `Uploaded · ${item.file!.kindLabel} · ${formatSize(item.file!.sizeBytes)}`}
                  </span>
                )}
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
                <button
                  type="button"
                  data-remove=""
                  onClick={(event) => void remove(item, event.currentTarget)}
                  className={cx(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-h-11')}
                >
                  Remove<span className="sr-only"> {item.name}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* Lines are added, never replaced: a polite log reads each one (screens-4). */}
      <div role="log" aria-live="polite" className="sr-only" data-testid="evidence-log">
        {log.map((line) => (
          <p key={line.id}>{line.text}</p>
        ))}
      </div>
    </div>
  );
}
