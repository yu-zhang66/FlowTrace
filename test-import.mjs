import('@flowtrace/core').then(m => {
  console.log('computeStatus:', typeof m.computeStatus);
  console.log('resolveProcess:', typeof m.resolveProcess);
  console.log('statusFromError:', typeof m.statusFromError);
}).catch(e => console.error('Failed:', e.message));
