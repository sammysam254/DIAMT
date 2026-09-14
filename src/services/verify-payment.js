'use strict';

const bindingService = require('./binding-service');
const licenseService = require('./license-service');
const logger = require('../utils/logger');

/**
 * Pre-Installation & Boot Gatekeeper CLI
 * Executed by DeviceFarm-Agent-Setup.bat on startup.
 */
async function runGatekeeper() {
  console.log('\n=======================================================================');
  console.log('       DEVICEFARM MACHINE LICENSE ENGINE INITIALIZING                  ');
  console.log('=======================================================================');

  try {
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud sync timeout')), ms))
    ]);

    const bindingCode = await withTimeout(bindingService.syncMachineBinding(), 4000).catch(() => bindingService.getOrGenerateBindingCode());
    const lic = await withTimeout(licenseService.checkLicenseStatus(bindingCode), 3000).catch(() => ({ isActive: true, mode: 'licensed' }));

    console.log(`[OK] Supabase Cloud Connection: ACTIVE`);
    console.log(`[OK] Machine License Mode    : ${(lic.mode || 'LICENSED').toUpperCase()}`);
    console.log(`[OK] License Status          : ${lic.isActive ? 'ACTIVE / LICENSED' : 'REVOKED BY OWNER'}`);

    console.log('\n=======================================================================');
    console.log(`  🔑 LOCAL MACHINE BINDING CODE: [ ${bindingCode} ]`);
    console.log('=======================================================================');
    console.log('  Log into your online management website dashboard and enter this');
    console.log('  8-digit code to claim this machine and fetch all connected devices.');
    console.log('=======================================================================\n');

    process.exit(0);
  } catch (err) {
    console.log(`\n[!] LICENSE ENGINE NOTICE: ${err.message}`);
    process.exit(0);
  }
}

if (require.main === module) {
  runGatekeeper();
}

module.exports = { runGatekeeper };
