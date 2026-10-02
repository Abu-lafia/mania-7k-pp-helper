// Offline regression checks: no credentials, live API or downloaded snapshot required.
for (const test of ['top50','hybrid','multisource','rankings','progressive','visitor','exact-membership','progressive-ui']) {
  await import(`./${test}-check.mjs`);
}
