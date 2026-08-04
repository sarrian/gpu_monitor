const { spawn } = require('child_process');
const path = require('path');

console.log('=== GPU Monitor Debug ===');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('PATH:', process.env.PATH?.split(';').filter(Boolean).slice(0, 5).join('\n  '));
console.log();

const fields = [
  '--query-gpu=name,uuid,index,temperature.gpu,power.draw',
  '--format=csv,noheader,nounits'
];

console.log('Running:', 'nvidia-smi', fields.join(' '));

const proc = spawn('nvidia-smi', fields);
let stdout = '', stderr = '';

proc.stdout.on('data', (d) => { stdout += d; });
proc.stderr.on('data', (d) => { stderr += d; });
proc.on('error', (e) => { console.error('spawn error:', e.message); });
proc.on('close', (code) => {
  console.log('Exit code:', code);
  console.log('stdout:', JSON.stringify(stdout));
  console.log('stderr:', JSON.stringify(stderr));
});

// Timeout after 5 seconds
setTimeout(() => {
  if (!proc.killed) {
    proc.kill();
    console.log('TIMED OUT — no output');
  }
}, 5000);
