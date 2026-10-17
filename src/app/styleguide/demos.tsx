'use client';

// Interactive specimens of the style guide: dialog, bottom sheet, menu, toast and tabs.

import { useState } from 'react';
import { ArrowRightIcon, ChevronDownIcon } from '@/components/icons';
import { Legend } from '@/components/ink/legend';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Drawer, PEEK } from '@/components/ui/drawer';
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { TrailChip } from '@/components/ui/trail-chip';

export function OverlayDemos() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [peek, setPeek] = useState(false);
  const [trail, setTrail] = useState(['Lo Laam-fung', 'Fung Lam-chau']);

  return (
    <div className="flex flex-wrap gap-3">
      <Dialog
        trigger={<Button>Open a dialog</Button>}
        title="Withdraw this claim?"
        description="The link to Mira Probnova goes back to unconfirmed. You can submit it again later."
        footer={
          <>
            <DialogClose render={<Button variant="ghost" />}>Keep it</DialogClose>
            <DialogClose render={<Button variant="primary" />}>Withdraw</DialogClose>
          </>
        }
      />

      <Button onClick={() => setSheet(true)}>Open a sheet</Button>
      <Drawer open={sheet} onOpenChange={setSheet} title="Mira Probnova" description="Sofia · Sifu · from 2009">
        <div className="grid gap-4 pt-1">
          <p className="text-fg-muted">
            Drag the sheet by any part of it, or use Expand and Close. Back closes it, and so does Esc.
          </p>
          <div className="grid gap-2">
            <p className="eyebrow">Teachers</p>
            <p className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-lg">Stefan Primerov</span>
              <StatusBadge state="verified" />
            </p>
            <p className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-lg">A teacher from another hall</span>
              <StatusBadge state="cross_lineage" />
            </p>
          </div>
          <Legend layout="list" descriptions />
        </div>
      </Drawer>

      <Button onClick={() => setPeek(true)}>Show a peek sheet</Button>
      <Drawer
        open={peek}
        onOpenChange={setPeek}
        modal={false}
        snapPoints={[PEEK, 1]}
        title="Jade Lantern Hall"
        description="Foshan · 8 generations · 24 people"
      >
        <p className="pt-1 text-fg-muted">
          A {PEEK} peek that leaves the page usable behind it, as over a map or a graph. Expand it for the details.
        </p>
      </Drawer>

      <MenuRoot>
        <MenuTrigger render={<Button />}>
          Actions
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={() => toast.add({ title: 'Link copied', description: 'The address of this page is on the clipboard.' })}>
            Copy link
          </MenuItem>
          <MenuItem>Show in the list</MenuItem>
          <MenuSeparator />
          <MenuItem disabled>Request a correction</MenuItem>
        </MenuContent>
      </MenuRoot>

      <Button
        variant="ink"
        onClick={() => toast.add({ title: 'Request sent', description: 'Stefan Primerov sees it the next time he signs in.' })}
      >
        Show a toast
        <ArrowRightIcon />
      </Button>

      {trail.length > 1 ? (
        <TrailChip name={trail[trail.length - 2]!} onClick={() => setTrail((t) => t.slice(0, -1))} />
      ) : (
        <Button variant="ghost" onClick={() => setTrail(['Lo Laam-fung', 'Fung Lam-chau'])}>
          Reset the trail chip
        </Button>
      )}
    </div>
  );
}

export function TabsDemo() {
  return (
    <Tabs defaultValue="teachers">
      <TabsList aria-label="Profile sections">
        <Tab value="teachers">Teachers</Tab>
        <Tab value="students">Students</Tab>
        <Tab value="schools">Schools</Tab>
      </TabsList>
      <TabsPanel value="teachers">
        <p className="text-fg-muted">Two teachers: one verified, one from another hall.</p>
      </TabsPanel>
      <TabsPanel value="students">
        <p className="text-fg-muted">No verified students yet. Students send a request from this profile.</p>
      </TabsPanel>
      <TabsPanel value="schools">
        <p className="text-fg-muted">Teaches at one school in Sofia.</p>
      </TabsPanel>
    </Tabs>
  );
}
