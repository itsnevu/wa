import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function childClose(child) {
  return new Promise(resolve => {
    let error;
    child.once('error', failure => { error = failure; });
    child.once('close', (code, signal) => resolve({ code, signal, error }));
  });
}

async function waitForClose(closed, timeoutMs) {
  let timer;
  try {
    return await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function stopFixtureChild(child, closed, stop = () => child.kill(), force = forceTree) {
  if (child.pid && child.exitCode === null && child.signalCode === null) stop();
  const result = await waitForClose(closed, 7000);
  if (result) return result;

  await force(child);
  const forced = await waitForClose(closed, 5000);
  if (!forced) throw Error(`Fixture process ${child.pid} did not close`);
  return forced;
}

export function stopFixtureBrowser(child, closed, socket) {
  if (socket?.readyState !== 1) {
    socket?.close();
    return stopFixtureChild(child, closed);
  }
  return stopFixtureChild(child, closed, () => {
    socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
    socket.close();
  });
}

async function forceTree(child) {
  if (process.platform === 'win32') {
    await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, timeout: 5000,
    }).catch(error => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
  } else {
    child.kill('SIGKILL');
  }
}
