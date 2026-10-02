// Offline regression checks: no credentials, live API or downloaded snapshot required.
for (const test of ['top50','hybrid','multisource','rankings','progressive','visitor']) {
  await import(`./${test}-check.mjs`);
}
