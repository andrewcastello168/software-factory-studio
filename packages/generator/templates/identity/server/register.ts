import type { Router } from 'express';
import type { Pool } from 'pg';
import { registerAuthentication } from './authentication.ts';
@@AUDITFALLBACK@@
@@IDENTITYIMPORTS@@
export function registerIdentity(router: Router, pool?: Pool) {
  const audit = @@IDENTITYAUDITOR@@;
  registerAuthentication(router, pool, @@IDENTITYPERMISSIONS@@, audit, @@IDENTITYRBAC@@);
  if (!pool) return;
@@IDENTITYROUTES@@}
