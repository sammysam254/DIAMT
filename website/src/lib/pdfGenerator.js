import { jsPDF } from 'jspdf';

// ══════════════════════════════════════════════════════════════════════════════
// DIAMT PLATFORM — EXECUTIVE GREEN THEME PDF GENERATOR
// Professional vector letterheads, audit seals, claim records & termination docs
// ══════════════════════════════════════════════════════════════════════════════

// Palette Constants (Executive Emerald Theme)
const COLORS = {
  emeraldDark: [6, 78, 59],       // #064e3b - Deep Forest Green
  emeraldPrimary: [5, 150, 105],  // #059669 - Brand Emerald
  emeraldLight: [16, 185, 129],   // #10b981 - Bright Emerald
  emeraldTint: [236, 253, 245],   // #ecfdf5 - Subtle Green BG
  emeraldBorder: [167, 243, 208], // #a7f3d0 - Soft Green Border
  textDark: [15, 23, 42],         // #0f172a - Slate Dark
  textMuted: [71, 85, 105],       // #475569 - Slate Muted
  textLight: [148, 163, 184],     // #94a3b8 - Dim Slate
  white: [255, 255, 255],
  redDark: [153, 27, 27],         // #991b1b
  redTint: [254, 242, 242],       // #fef2f2
  redBorder: [254, 202, 202],     // #fecaca
  amberDark: [180, 83, 9],        // #b45309
  amberTint: [254, 243, 199],     // #fef3c7
};

/**
 * Draw DIAMT Official Brand Header with Logo Symbol in Green Palette
 */
function drawBrandHeader(doc, title, subtitle, documentRef = '') {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top Accent Banner (Deep Emerald Gradient simulation)
  doc.setFillColor(...COLORS.emeraldDark);
  doc.rect(0, 0, pageWidth, 7, 'F');

  doc.setFillColor(...COLORS.emeraldPrimary);
  doc.rect(0, 7, pageWidth, 2, 'F');

  // Brand Logo Badge (Vector rounded box with device icon)
  const logoX = 16;
  const logoY = 16;
  doc.setFillColor(...COLORS.emeraldPrimary);
  doc.roundedRect(logoX, logoY, 15, 15, 3, 3, 'F');

  // White inner device symbol (Power / Streaming loop)
  doc.setDrawColor(...COLORS.white);
  doc.setLineWidth(0.8);
  // Outer circle arc
  doc.circle(logoX + 7.5, logoY + 7.5, 4.2);
  // Inner tick
  doc.line(logoX + 7.5, logoY + 4.5, logoX + 7.5, logoY + 7.5);

  // Brand Typography
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('DIAMT', logoX + 19, logoY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.emeraldPrimary);
  doc.text('AUTONOMOUS DEVICE CLOUD', logoX + 19, logoY + 13);

  // Right-aligned Document Meta
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text(title.toUpperCase(), pageWidth - 16, logoY + 6, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.textMuted);
  if (subtitle) {
    doc.text(subtitle, pageWidth - 16, logoY + 11, { align: 'right' });
  }
  if (documentRef) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.emeraldPrimary);
    doc.text(`REF: ${documentRef}`, pageWidth - 16, logoY + 15.5, { align: 'right' });
  }

  // Divider Line
  doc.setDrawColor(...COLORS.emeraldBorder);
  doc.setLineWidth(0.5);
  doc.line(16, 36, pageWidth - 16, 36);

  return 42; // Returns next available Y coordinate
}

/**
 * Draw Official DIAMT Seal & Verification Footer
 */
function drawFooterAndSeal(doc, pageNumber = 1, totalPages = 1) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 22;

  // Bottom Border
  doc.setDrawColor(...COLORS.emeraldBorder);
  doc.setLineWidth(0.5);
  doc.line(16, footerY, pageWidth - 16, footerY);

  // Digital Security Watermark
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.emeraldPrimary);
  doc.text('VERIFIED SYSTEM RECORD', 16, footerY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.textMuted);
  doc.text('Cryptographically generated & audited by DIAMT Farm Gateway Core. Immutable database audit.', 16, footerY + 10);
  doc.text('Proprietary & Confidential - For Authorized Personnel Only.', 16, footerY + 14);

  // Page Numbers
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - 16, footerY + 8, { align: 'right' });

  // Timestamp
  const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Generated: ${now}`, pageWidth - 16, footerY + 13, { align: 'right' });
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 1. WORKER WEEKLY CLAIMS RECORD (PDF)
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function generateWeeklyWorkerClaimsPdf({ worker, weekIdentifier, claims = [], summary = {} }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const ref = `WCR-${weekIdentifier}-${(worker?.email || 'WORKER').substring(0, 4).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  let y = drawBrandHeader(
    doc,
    'Weekly Claims Record',
    `Audit Statement for Week ${weekIdentifier}`,
    ref
  );

  // Worker Info Box (Executive Green Tint)
  doc.setFillColor(...COLORS.emeraldTint);
  doc.setDrawColor(...COLORS.emeraldBorder);
  doc.setLineWidth(0.4);
  doc.roundedRect(16, y, pageWidth - 32, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('WORKER CREDENTIALS & PROFILE', 22, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text('Worker Email:', 22, y + 14);
  doc.text('Assigned Plan:', 22, y + 21);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.textDark);
  doc.text(worker?.email || 'N/A', 52, y + 14);
  const planDisplay = (worker?.claim_criteria || 'daily_10') === 'weekly_40' 
    ? 'Standard Weekly $40 Plan ($40 / week target)' 
    : 'Standard Daily $10 Plan ($10 / eligible claim)';
  doc.text(planDisplay, 52, y + 21);

  // Right column of box
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.textMuted);
  doc.text('Audit Week:', pageWidth - 80, y + 14);
  doc.text('Account Status:', pageWidth - 80, y + 21);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text(weekIdentifier || 'Current', pageWidth - 50, y + 14);
  const isSuspended = worker?.is_auto_suspended;
  if (isSuspended) {
    doc.setTextColor(...COLORS.redDark);
    doc.text('SUSPENDED', pageWidth - 50, y + 21);
  } else {
    doc.setTextColor(...COLORS.emeraldPrimary);
    doc.text('ACTIVE & VERIFIED', pageWidth - 50, y + 21);
  }

  y += 35;

  // Financial & Claim Metrics Cards
  const totalClaimed = claims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const approvedClaims = claims.filter(c => c.status === 'approved');
  const totalApproved = approvedClaims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const pendingCount = claims.filter(c => c.status === 'pending').length;
  const rejectedCount = claims.filter(c => c.status === 'rejected').length;

  const cardW = (pageWidth - 32 - 9) / 4;
  const metrics = [
    { label: 'TOTAL SUBMITTED', val: `$${totalClaimed.toFixed(2)}`, color: COLORS.emeraldDark },
    { label: 'APPROVED CLAIMS', val: `$${totalApproved.toFixed(2)}`, color: COLORS.emeraldPrimary },
    { label: 'PENDING REVIEWS', val: `${pendingCount}`, color: COLORS.amberDark },
    { label: 'REJECTED CLAIMS', val: `${rejectedCount}`, color: COLORS.redDark },
  ];

  metrics.forEach((m, idx) => {
    const cardX = 16 + idx * (cardW + 3);
    doc.setFillColor(250, 250, 252);
    doc.setDrawColor(...COLORS.emeraldBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, y, cardW, 18, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(m.label, cardX + cardW / 2, y + 6, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...m.color);
    doc.text(m.val, cardX + cardW / 2, y + 14, { align: 'center' });
  });

  y += 26;

  // Table Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('RECORDED CLAIMS FOR THE PERIOD', 16, y);
  y += 5;

  // Table Column Titles
  doc.setFillColor(...COLORS.emeraldPrimary);
  doc.rect(16, y, pageWidth - 32, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.white);
  doc.text('DAY', 20, y + 5.5);
  doc.text('DATE', 42, y + 5.5);
  doc.text('PLAN', 68, y + 5.5);
  doc.text('AMOUNT', 98, y + 5.5);
  doc.text('STATUS', 122, y + 5.5);
  doc.text('VERIFICATION / APPROVER', 148, y + 5.5);

  y += 8;

  // Table Body Rows
  if (claims.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text('No claims recorded for this week cycle.', pageWidth / 2, y + 10, { align: 'center' });
    y += 20;
  } else {
    claims.forEach((claim, idx) => {
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? 255 : 246, isEven ? 255 : 251, isEven ? 255 : 249);
      doc.rect(16, y, pageWidth - 32, 7.5, 'F');

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      doc.line(16, y + 7.5, pageWidth - 16, y + 7.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.textDark);
      doc.text(claim.day_of_week || '—', 20, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.text(claim.claim_date || '—', 42, y + 5);
      doc.text(claim.plan_type === 'weekly_40' ? 'Weekly $40' : 'Daily $10', 68, y + 5);

      doc.setFont('helvetica', 'bold');
      doc.text(`$${parseFloat(claim.amount || 0).toFixed(2)}`, 98, y + 5);

      // Status pill
      const st = (claim.status || 'pending').toUpperCase();
      if (st === 'APPROVED') {
        doc.setTextColor(...COLORS.emeraldPrimary);
      } else if (st === 'REJECTED') {
        doc.setTextColor(...COLORS.redDark);
      } else {
        doc.setTextColor(...COLORS.amberDark);
      }
      doc.text(st, 122, y + 5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.textMuted);
      const approverInfo = claim.is_forced_by_seed
        ? `★ Seed Issued (${new Date(claim.approved_at || claim.claimed_at).toLocaleDateString()})`
        : claim.approver_email 
        ? `${claim.approver_email} (${new Date(claim.approved_at || claim.updated_at).toLocaleDateString()})`
        : claim.status === 'rejected' ? (claim.rejection_reason || 'Rejected by Admin') : 'Awaiting Review';
      doc.text(approverInfo.substring(0, 32), 148, y + 5);

      y += 7.5;
    });
  }

  // Summary Note & Statement
  y += 8;
  doc.setFillColor(...COLORS.emeraldTint);
  doc.setDrawColor(...COLORS.emeraldBorder);
  doc.roundedRect(16, y, pageWidth - 32, 18, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('OFFICIAL SETTLEMENT STATEMENT:', 20, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    'Claims listed as APPROVED have completed administrative authorization and require no further disbursement actions.\nAll records are permanently synchronized to the DIAMT autonomous database.',
    20,
    y + 11
  );

  drawFooterAndSeal(doc, 1, 1);
  doc.save(`DIAMT_Weekly_Claims_${weekIdentifier}_${worker?.email?.split('@')[0] || 'worker'}.pdf`);
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 2. OFFICIAL EMPLOYMENT TERMINATION LETTER (PDF)
 * Formal letterhead, green executive theme, target violation citation, 8 AM exit
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function generateTerminationLetterPdf({ worker, weekIdentifier, reason = '', claims = [] }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const ref = `TRM-DIAMT-${weekIdentifier || 'W'}-${Date.now().toString().slice(-5)}`;
  let y = drawBrandHeader(
    doc,
    'Formal Termination Notice',
    'Official Notice of Automatic Suspension',
    ref
  );

  // Formal Date & Addressee
  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(`Date of Notice: ${todayStr}`, 16, y);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.textDark);
  doc.text(`TO: ${worker?.email || 'Worker Member'}`, 16, y);
  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(`Account Reference ID: ${worker?.id || 'SYS-USER'} | Audit Cycle: ${weekIdentifier || 'Active'}`, 16, y);

  y += 10;

  // Urgent Notice Callout Banner (Executive Maroon/Green Boundary)
  doc.setFillColor(254, 242, 242);
  doc.setDrawColor(239, 68, 68);
  doc.setLineWidth(0.8);
  doc.roundedRect(16, y, pageWidth - 32, 22, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.redDark);
  doc.text('MANDATORY NOTICE OF AUTOMATIC SYSTEM TERMINATION', 22, y + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(185, 28, 28);
  doc.text('ACTION REQUIRED: VACATE STATION FACILITY BEFORE TOMORROW AT 08:00 AM', 22, y + 15);

  y += 30;

  // Body Content
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.textDark);
  doc.text('Subject: Immediate Suspension & Service Termination Due to Weekly Target Default', 16, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.textDark);
  const planName = worker?.claim_criteria === 'weekly_40' ? 'Weekly $40 Target Plan' : 'Daily $10 Target Plan';

  const body1 = `This official letter serves as formal notification that your account and active deployment with DIAMT Platform have been automatically suspended by the system compliance engine effective immediately.`;
  doc.text(body1, 16, y, { maxWidth: pageWidth - 32, lineHeightFactor: 1.4 });
  y += 12;

  const defaultReason = `Due to failing to achieve the weekly target rule as per your subscribed plan (${planName}) during week cycle ${weekIdentifier}, the automated performance compliance system has enforced full account suspension. Consequently, your active services are no longer required by the organization.`;
  const fullReason = reason || defaultReason;

  doc.setFillColor(...COLORS.emeraldTint);
  doc.setDrawColor(...COLORS.emeraldBorder);
  doc.setLineWidth(0.4);
  doc.roundedRect(16, y, pageWidth - 32, 22, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('SYSTEM AUDIT SPECIFICATION:', 20, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textDark);
  doc.text(fullReason, 20, y + 11, { maxWidth: pageWidth - 40, lineHeightFactor: 1.35 });
  y += 28;

  // Mandatory Departure Directive
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.textDark);
  doc.text('Mandatory Exit & Protocol Directives:', 16, y);
  y += 6;

  const directives = [
    'Immediate Revocation: All hardware access privileges, live device streaming sessions, and credentials have been permanently locked.',
    'Station Departure Deadline: As your services are no longer needed, you are strictly required to hand over any facility equipment and leave the station before tomorrow at 8:00 AM sharp.',
    'Clearance Authority: This termination was executed by automated system enforcement. In accordance with organizational policy, only the Seed Administrator (sammyseth260@gmail.com) holds exclusive authorization to review or reinstate a suspended account.',
    'Final Claims Audit: All legitimate and approved claims submitted prior to termination have been documented in your attached weekly audit statement.'
  ];

  directives.forEach(dir => {
    doc.setFillColor(...COLORS.emeraldPrimary);
    doc.circle(19, y - 1, 1, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.textDark);
    doc.text(dir, 23, y, { maxWidth: pageWidth - 42, lineHeightFactor: 1.3 });
    y += 11;
  });

  y += 4;

  // Performance Summary Table for that suspension week
  if (claims && claims.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.emeraldDark);
    doc.text(`Performance Log for Week of Suspension (${weekIdentifier}):`, 16, y);
    y += 5;

    doc.setFillColor(...COLORS.emeraldPrimary);
    doc.rect(16, y, pageWidth - 32, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.white);
    doc.text('DAY', 20, y + 4.2);
    doc.text('DATE', 50, y + 4.2);
    doc.text('AMOUNT', 90, y + 4.2);
    doc.text('STATUS', 130, y + 4.2);
    y += 6;

    claims.slice(0, 5).forEach((c, idx) => {
      doc.setFillColor(idx % 2 === 0 ? 255 : 248);
      doc.rect(16, y, pageWidth - 32, 5.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.textDark);
      doc.text(c.day_of_week || '—', 20, y + 3.8);
      doc.text(c.claim_date || '—', 50, y + 3.8);
      doc.text(`$${parseFloat(c.amount || 0).toFixed(2)}`, 90, y + 3.8);
      doc.text((c.status || '').toUpperCase(), 130, y + 3.8);
      y += 5.5;
    });
    y += 4;
  }

  // Official Sign-Off Block
  y = Math.max(y, doc.internal.pageSize.getHeight() - 48);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('DIAMT PLATFORM COMPLIANCE & AUDIT GATEWAY', 16, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text('Authorized by: Automated Compliance Engine', 16, y);
  doc.text('Appeals / Reinstatement: Seed Administrator Clearance Only', 16, y + 4);

  // Digital Stamp Box
  const stampX = pageWidth - 65;
  doc.setDrawColor(...COLORS.emeraldPrimary);
  doc.setLineWidth(0.6);
  doc.roundedRect(stampX, y - 6, 49, 16, 2, 2, 'D');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.emeraldPrimary);
  doc.text('★ DIAMT COMPLIANCE ★', stampX + 24.5, y - 1, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('SYSTEM TERMINATION CONFIRMED', stampX + 24.5, y + 3.5, { align: 'center' });
  doc.text(`AUDIT ID: ${weekIdentifier}`, stampX + 24.5, y + 7.5, { align: 'center' });

  drawFooterAndSeal(doc, 1, 1);
  doc.save(`DIAMT_Termination_Letter_${worker?.email?.split('@')[0] || 'Worker'}_${weekIdentifier}.pdf`);
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 3. ADMIN WEEKLY AUDIT & CLAIMS REPORT (PDF)
 * Filtered by Week and (All Users OR Specific Worker) in Executive Green Theme
 * ══════════════════════════════════════════════════════════════════════════════
 */
export function generateAdminWeeklyClaimsReportPdf({ weekIdentifier, claims = [], workers = [], filterWorkerEmail = null }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const isSingleUser = Boolean(filterWorkerEmail && filterWorkerEmail !== 'ALL');
  const targetLabel = isSingleUser ? `Worker: ${filterWorkerEmail}` : 'All System Workers';
  const ref = `ADM-REP-${weekIdentifier}-${Date.now().toString().slice(-5)}`;

  let y = drawBrandHeader(
    doc,
    'Administrative Claims Report',
    `Audit Summary: ${targetLabel} (${weekIdentifier})`,
    ref
  );

  // Summary Metrics Banner
  const totalClaimsCount = claims.length;
  const approvedList = claims.filter(c => c.status === 'approved');
  const pendingList = claims.filter(c => c.status === 'pending');
  const rejectedList = claims.filter(c => c.status === 'rejected');

  const totalValue = claims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const approvedValue = approvedList.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const pendingValue = pendingList.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);

  const colWidth = (pageWidth - 32 - 9) / 4;
  const adminMetrics = [
    { label: 'TOTAL SUBMITTED', val: `$${totalValue.toFixed(2)} (${totalClaimsCount})`, color: COLORS.emeraldDark },
    { label: 'APPROVED TOTAL', val: `$${approvedValue.toFixed(2)} (${approvedList.length})`, color: COLORS.emeraldPrimary },
    { label: 'PENDING ACTION', val: `$${pendingValue.toFixed(2)} (${pendingList.length})`, color: COLORS.amberDark },
    { label: 'REJECTED TOTAL', val: `${rejectedList.length} claims`, color: COLORS.redDark },
  ];

  adminMetrics.forEach((m, idx) => {
    const cardX = 16 + idx * (colWidth + 3);
    doc.setFillColor(...COLORS.emeraldTint);
    doc.setDrawColor(...COLORS.emeraldBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, y, colWidth, 18, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(m.label, cardX + colWidth / 2, y + 6, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...m.color);
    doc.text(m.val, cardX + colWidth / 2, y + 14, { align: 'center' });
  });

  y += 26;

  // Filter & Audit Parameters Box
  doc.setFillColor(250, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(16, y, pageWidth - 32, 14, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.emeraldDark);
  doc.text('AUDIT PARAMETERS & SCOPE:', 20, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(`Week Identifier: ${weekIdentifier}   |   Target Filter: ${targetLabel}   |   Total Rows: ${claims.length}`, 20, y + 10.5);

  y += 20;

  // Table Header
  doc.setFillColor(...COLORS.emeraldDark);
  doc.rect(16, y, pageWidth - 32, 7.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.white);
  doc.text('WORKER', 20, y + 5);
  doc.text('DAY', 65, y + 5);
  doc.text('DATE', 88, y + 5);
  doc.text('PLAN', 110, y + 5);
  doc.text('AMOUNT', 130, y + 5);
  doc.text('STATUS', 150, y + 5);
  doc.text('APPROVER', 170, y + 5);

  y += 7.5;

  if (claims.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text('No claims records match the current filter selection.', pageWidth / 2, y + 12, { align: 'center' });
    y += 24;
  } else {
    // Up to 25 items per page with clean layout
    claims.slice(0, 26).forEach((c, idx) => {
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? 255 : 246, isEven ? 255 : 251, isEven ? 255 : 249);
      doc.rect(16, y, pageWidth - 32, 6.5, 'F');

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      doc.line(16, y + 6.5, pageWidth - 16, y + 6.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.textDark);
      doc.text((c.worker_email || '—').substring(0, 24), 20, y + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.text(c.day_of_week || '—', 65, y + 4.5);
      doc.text(c.claim_date || '—', 88, y + 4.5);
      doc.text(c.plan_type === 'weekly_40' ? 'Weekly' : 'Daily', 110, y + 4.5);

      doc.setFont('helvetica', 'bold');
      doc.text(`$${parseFloat(c.amount || 0).toFixed(2)}`, 130, y + 4.5);

      const st = (c.status || 'pending').toUpperCase();
      if (st === 'APPROVED') doc.setTextColor(...COLORS.emeraldPrimary);
      else if (st === 'REJECTED') doc.setTextColor(...COLORS.redDark);
      else doc.setTextColor(...COLORS.amberDark);
      doc.text(st, 150, y + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.textMuted);
      const app = c.is_forced_by_seed 
        ? '★ Seed Issued' 
        : c.approver_email ? c.approver_email.split('@')[0] : (c.status === 'pending' ? 'Pending' : '—');
      doc.text(app.substring(0, 16), 170, y + 4.5);

      y += 6.5;
    });

    if (claims.length > 26) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.textMuted);
      doc.text(`* Showing first 26 of ${claims.length} total recorded entries for this reporting period.`, 16, y + 5);
      y += 8;
    }
  }

  drawFooterAndSeal(doc, 1, 1);
  const outName = isSingleUser 
    ? `DIAMT_Claims_${weekIdentifier}_${filterWorkerEmail.split('@')[0]}.pdf`
    : `DIAMT_Admin_Claims_Report_${weekIdentifier}.pdf`;
  doc.save(outName);
}
