'use client';

// A teacher's students in the panel (plan §4.8; milestone M06, package C): orpc.people.students in
// pages of 20 (DEFAULT, no D number), Previous and Next, active students first, each name a link
// to the profile and an "Explore from here" link, all at least 44 px tall on phones.
//
// Package F's stub: nothing is shown.

import type { ReactNode } from 'react';

export interface StudentsListProps {
  /** The teacher whose students are listed. */
  teacherId: string;
  slug: string;
  name: string;
}

export const StudentsList: (props: StudentsListProps) => ReactNode = () => null;
