// The share image of a lineage card (ADR 0045): one route of descent as a 1200 × 630 PNG, from
// the public card only (people.card), so it carries no one whose profile is not public. `?route=N`
// as on the card page; the longest route otherwise. The fonts are the app's own and text in
// another script is left out (src/lib/og-text.ts), so the image makes no outside request. A card
// that does not exist answers a plain image with status 404.

import { headers } from 'next/headers';
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

import { chosenRoute } from '@/lib/lineage-card-route';
import { OG_COLOURS, OG_FONT, ogFonts } from '@/lib/og-fonts';
import { drawable } from '@/lib/og-text';
import { getRequestPrincipal } from '@/server/auth/web';
import { ORPCError, serverClient } from '@/server/rpc/server';

const SIZE = { width: 1200, height: 630 };
const { ink: INK, paper: PAPER, muted: MUTED, seal: SEAL } = OG_COLOURS;
/** Names drawn at most: the earliest teacher, an ellipsis, then the last generations. */
const SHOWN = 5;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const options = { ...SIZE, fonts: await ogFonts(), headers: { 'Cache-Control': 'public, max-age=300' } };
  let card;
  try {
    card = await serverClient(await headers(), await getRequestPrincipal()).people.card({ slug });
  } catch (error) {
    const missing = error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST');
    return new ImageResponse(
      (
        <div style={{ display: 'flex', width: '100%', height: '100%', background: INK, color: PAPER, alignItems: 'center', justifyContent: 'center', fontSize: 64, fontFamily: OG_FONT }}>
          WingChunRoots
        </div>
      ),
      { ...options, headers: { 'Cache-Control': 'no-store' }, status: missing ? 404 : 503 },
    );
  }
  const index = chosenRoute(card, request.nextUrl.searchParams.get('route') ?? undefined);
  const route = index >= 0 ? card.paths.paths[index]! : null;
  const people = new Map(card.paths.nodes.map((n) => [n.id, n]));
  const names = (route?.personIds ?? [card.personId]).map((id) => drawable(people.get(id)?.displayName ?? '') || 'A member');
  const shown = names.length > SHOWN ? [names[0]!, '…', ...names.slice(-(SHOWN - 2))] : names;
  const focus = names[names.length - 1]!;
  const lastEdge = route ? card.paths.edges.find((e) => e.id === route.edgeIds[route.edgeIds.length - 1]) : undefined;
  const lineage = drawable((lastEdge && card.paths.lineages.find((l) => l.id === lastEdge.lineageId)?.name) || '');
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: INK, color: PAPER, padding: '56px 72px', fontFamily: OG_FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28, color: MUTED }}>
          <div style={{ display: 'flex', width: 28, height: 28, background: SEAL, borderRadius: 4 }} />
          WingChunRoots · Lineage card
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 36 }}>
          <div style={{ display: 'flex', fontSize: focus.length > 32 ? 60 : 76, lineHeight: 1.05 }}>{focus}</div>
          <div style={{ display: 'flex', fontSize: 30, color: MUTED }}>
            {`${lineage ? `${lineage} · ` : ''}${names.length === 1 ? '1 generation' : `${names.length} generations`}`}
          </div>
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'flex-end', alignContent: 'flex-end', gap: 14, paddingTop: 40, flexWrap: 'wrap', fontSize: 30 }}>
          {shown.map((name, i) => {
            const last = i === shown.length - 1;
            return (
              <div key={`${i}-${name}`} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    padding: '10px 18px',
                    borderRadius: 4,
                    border: `2px solid ${last ? SEAL : PAPER}`,
                    background: last ? SEAL : 'transparent',
                    color: PAPER,
                  }}
                >
                  {name}
                </div>
                {last ? null : <div style={{ display: 'flex', color: MUTED }}>→</div>}
              </div>
            );
          })}
        </div>
      </div>
    ),
    options,
  );
}
