// ═══════════════════════════════════════════════════════════════════════════
// Centralized RBAC (role-based access control) for every API endpoint.
//
// Three roles, hierarchical (higher number = more access):
//   supervisor (1) — floor staff, data entry on production/maintenance widgets
//   manager    (2) — full access except Settings
//   admin      (3) — everything, including Settings
//
// Every backend handler should start with:
//
//   const perms = require('./_permissions');
//   const user = perms.requireAuth(req, res);   // sends 401 on bad/missing token
//   if (!user) return;
//   // per-action check:
//   if (!perms.canPerform(user, 'bids', 'delete')) return perms.deny(res, user, 'bids', 'delete');
//
// The helper `requireAccess(req, res, widget, action)` combines both steps when
// the whole endpoint uses the same permission.
// ═══════════════════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');

// Role hierarchy. Any role with a level >= the required role's level can perform.
const ROLE_LEVELS = { supervisor: 1, manager: 2, admin: 3 };

// Widget → action → required minimum role.
//
// Actions:
//   view   — read data (list, get, search)
//   create — add a new record / submit a data-entry form
//   edit   — modify an existing record
//   delete — remove / archive a record
//
// This table is the single source of truth. Backend AND frontend read from it
// (frontend imports a static copy in public/js/utils.js — keep them in sync).
const WIDGET_PERMS = {
  // ── Financial (managers+) ────────────────────────────────────────────
  bids:      { view:'manager',    create:'manager',    edit:'manager',    delete:'manager' },
  // ── Production (supervisors can view + create; managers+ can edit/delete) ─
  yield:         { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  trimmer:       { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  injection:     { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  flavor:        { view:'supervisor', create:'supervisor', edit:'manager', delete:'manager' },
  fishschedule:  { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  production:    { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  // Employee Scheduling — supervisors view, managers edit teams/shifts.
  // Production workers see the schedule via the read-only TV kiosk
  // (Phase 1B), which uses a separate token-scoped API and bypasses perms.
  staffschedule: { view:'supervisor', create:'manager',    edit:'manager', delete:'manager' },
  // Production Report (Phase C) — read-only dashboard. Manager+ only because
  // it surfaces farmer pricing + payables supervisors shouldn't see.
  productionreport: { view:'manager' },
  // ── Maintenance (supervisors can view + create; managers+ can edit/delete) ─
  parts:     { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  todo:      { view:'supervisor', create:'supervisor', edit:'manager',    delete:'manager' },
  // ── Tools (managers+) ────────────────────────────────────────────────
  ai:            { view:'manager',    create:'manager',    edit:'manager',    delete:'manager' },
  // `ask` is a custom action used by the Union Contract widget for "Ask the
  // Lawyer" — manager+ can invoke it; upload / edit / delete remain admin-only.
  contracts:     { view:'manager',    create:'admin',      edit:'admin',      delete:'admin',   ask:'manager' },
  // ── Settings / platform admin (admin only) ───────────────────────────
  settings:  { view:'admin',      create:'admin',      edit:'admin',      delete:'admin' }
};

// Category mapping — used by the frontend dashboard to filter out entire
// category sections when the user can't view any widget in them.
const WIDGET_CATEGORIES = {
  bids:      'financial',
  yield:     'production',
  trimmer:   'production',
  injection: 'production',
  flavor:       'production',
  fishschedule: 'production',
  production:   'production',
  productionreport: 'production',
  staffschedule: 'production',
  parts:        'maintenance',
  todo:      'maintenance',
  ai:        'tools',
  contracts: 'tools',
  settings:  'settings'
};

class AuthError extends Error {
  constructor(msg, code) { super(msg); this.name = 'AuthError'; this.code = code || 401; }
}
class PermissionError extends Error {
  constructor(msg, code) { super(msg); this.name = 'PermissionError'; this.code = code || 403; }
}

function verifyToken(req) {
  const auth = req && req.headers && req.headers.authorization;
  if (!auth) throw new AuthError('No token');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth.replace(/^Bearer\s+/, '');
  if (!token) throw new AuthError('No token');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    throw new AuthError('Invalid token');
  }
}

function hasRoleLevel(user, minRole) {
  const userLevel = ROLE_LEVELS[user && user.role] || 0;
  const minLevel = ROLE_LEVELS[minRole] || 99;
  return userLevel >= minLevel;
}

function canPerform(user, widget, action) {
  const perms = WIDGET_PERMS[widget];
  if (!perms) return hasRoleLevel(user, 'admin'); // unknown widget → admin-only fail-safe
  const requiredRole = perms[action];
  if (!requiredRole) return hasRoleLevel(user, 'admin');
  return hasRoleLevel(user, requiredRole);
}

function requireAuth(req, res) {
  try {
    return verifyToken(req);
  } catch (e) {
    if (res) res.status(e.code || 401).json({ error: e.message || 'Unauthorized' });
    return null;
  }
}

function deny(res, user, widget, action) {
  return res.status(403).json({
    error: 'Forbidden',
    detail: 'Role "' + ((user && user.role) || 'unknown') + '" cannot ' + action + ' on ' + widget,
    widget, action
  });
}

// Combined auth + widget permission check for endpoints that use a single
// widget+action across their whole handler. Returns the user, or null if the
// response was already sent.
function requireAccess(req, res, widget, action) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!canPerform(user, widget, action)) {
    deny(res, user, widget, action);
    return null;
  }
  return user;
}

// Returns the action type for save_* endpoints: 'edit' if body carries an id
// for an existing record, 'create' otherwise.
function actionForSave(body) {
  return (body && body.id) ? 'edit' : 'create';
}

module.exports = {
  ROLE_LEVELS,
  WIDGET_PERMS,
  WIDGET_CATEGORIES,
  AuthError,
  PermissionError,
  verifyToken,
  hasRoleLevel,
  canPerform,
  requireAuth,
  requireAccess,
  deny,
  actionForSave
};
