import { inspect } from 'node:util';

export default async function* report(events) {
  let hookFailures = 0;
  for await (const { type, data } of events) {
    if (type === 'test:fail') {
      const hook = data.details.error?.failureType === 'hookFailed';
      if (hook) hookFailures++;
      yield `${hook ? 'HOOK FAILURE' : 'FAIL'} ${data.name}\n${inspect(data.details.error)}\n`;
    } else if (type === 'test:stdout' || type === 'test:stderr') {
      yield data.message;
    } else if (type === 'test:summary' && !data.file) {
      yield JSON.stringify({
        tests: data.counts.tests - hookFailures,
        passed: data.counts.passed,
        failed: data.counts.failed - hookFailures,
        skipped: data.counts.skipped,
        hookFailures,
        success: data.success,
      }) + '\n';
    }
  }
}
