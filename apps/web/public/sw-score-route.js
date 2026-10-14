/* LS-1 execution plan C27: only an exact fixture pad gets the static shell. */
self.scoringOfflineFixture = function scoringOfflineFixture(pathname) {
  const match = /^\/score\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(pathname);
  return match ? match[1] : null;
};
