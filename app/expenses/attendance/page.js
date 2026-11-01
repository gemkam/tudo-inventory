'use client';

import { useEffect } from 'react';

/* Attendance moved into Personnel > Employees > Attendance (1 Nov 2026). Old links and bookmarks land here and are sent on. */
export default function OldAttendance() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const co = q.get('co');
    const m = q.get('m');
    window.location.replace(`/personnel?tab=attendance${co ? `&co=${co}` : ''}${m ? `&m=${m}` : ''}`);
  }, []);
  return <div className="loading">Opening Personnel · Attendance...</div>;
}
