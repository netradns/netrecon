// NetRecon — Cloud CIDR Provider Data
// TIER_PRESETS matches netrecon-old exactly (names, sizes, colors)

'use strict';

// ── Default tier presets — EXACT from old version ────────────
var TIER_PRESETS = {
  aws: [
    { name: 'TGW Attach',        size: '28', color: '#6366f1' },
    { name: 'GWLB',              size: '28', color: '#8b5cf6' },
    { name: 'ALB / NLB (External)', size: '26', color: '#3b82f6' },
    { name: 'Application',       size: '23', color: '#10b981' },
    { name: 'Database',          size: '24', color: '#f59e0b' },
    { name: 'Internal ALB / NLB',size: '27', color: '#f97316' },
    { name: 'Storage',           size: '27', color: '#ec4899' },
    { name: 'VPC Endpoints',     size: '26', color: '#84cc16' }
  ],
  gcp: [
    { name: 'Application', size: '24', color: '#10b981' },
    { name: 'Database',    size: '24', color: '#059669' }
  ],
  azure: [
    { name: 'GatewaySubnet',  size: '27', color: '#6366f1' },
    { name: 'Application',    size: '24', color: '#10b981' },
    { name: 'Database',       size: '24', color: '#f59e0b' }
  ]
};

// ── Color palette — matches old version COLOR_PALETTE exactly ─
var COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4',
  '#10b981', '#059669', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#84cc16', '#64748b'
];
