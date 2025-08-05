// routes/schedulerService.js

function generateCrossBoardFixtures(boards) {
  const fixtures = [];
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      const A = boards[i];
      const B = boards[j];
      for (const teamA of A.teams) {
        for (const teamB of B.teams) {
          fixtures.push({
            teamA: teamA.trim(),
            boardA: A.name.trim(),
            teamB: teamB.trim(),
            boardB: B.name.trim()
          });
        }
      }
    }
  }
  return fixtures;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function teamsOf(match) {
  return [match.teamA, match.teamB];
}

function violatesGap(sequence, i, gap) {
  const t = teamsOf(sequence[i]);
  const start = Math.max(0, i - gap);
  for (let k = start; k < i; k++) {
    const prevTeams = teamsOf(sequence[k]);
    if (t.includes(prevTeams[0]) || t.includes(prevTeams[1])) return true;
  }
  return false;
}

function tryResolveAt(sequence, i, gap) {
  for (let j = i + 1; j < sequence.length; j++) {
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
    const okI = !violatesGap(sequence, i, gap);
    const okJ = !violatesGap(sequence, j, gap);
    const okAroundJ =
      (j - 1 < 0 || !violatesGap(sequence, j - 1, gap)) &&
      (j + 1 >= sequence.length || !violatesGap(sequence, j + 1, gap));

    if (okI && okJ && okAroundJ) return true;
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  }
  return false;
}

function shuffleWithGap(matches, gap = 1, attempts = 300) {
  if (gap < 1) return shuffle(matches);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const s = shuffle(matches);
    let failed = false;

    for (let i = 0; i < s.length; i++) {
      if (violatesGap(s, i, gap)) {
        const fixed = tryResolveAt(s, i, gap);
        if (!fixed) { failed = true; break; }
      }
    }
    if (!failed) return s;
  }
  return shuffle(matches); // fallback
}

module.exports = { generateCrossBoardFixtures, shuffleWithGap };
