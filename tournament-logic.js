/* =====================================================
   TOURNAMENT LOGIC MODULE
   Groups → Group Stage → Knockout → Placement
===================================================== */

/* =====================================================
   GROUPS MODULE
===================================================== */

var groups = {};  // { 'A': [p1Id, p2Id, p3Id], 'B': [...] }
var groupConfig = { 
  autoGenerate: true, 
  balanced: true, 
  sizeRange: [3, 5]
};

function autoGenerateGroups(teamsArray, numGroups) {
  /*
    Auto-balance teams into N groups.
    Distributes evenly: if 12 teams into 4 groups → 3 per group
    If 13 teams into 4 groups → [4, 3, 3, 3] or [3, 3, 3, 4]
  */
  if (!teamsArray || teamsArray.length === 0) return {};
  
  groups = {};
  var groupLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  var teamsPerGroup = Math.ceil(teamsArray.length / numGroups);
  var idx = 0;
  
  for (var i = 0; i < numGroups; i++) {
    var letter = groupLetters[i];
    groups[letter] = [];
    var groupSize = teamsPerGroup;
    // Distribute remainder evenly
    if (i < (teamsArray.length % numGroups)) groupSize++;
    
    for (var j = 0; j < groupSize && idx < teamsArray.length; j++) {
      groups[letter].push(teamsArray[idx].id);
      teamsArray[idx].group = letter;
      idx++;
    }
  }
  
  return groups;
}

function assignTeamToGroup(teamId, groupLetter) {
  /*
    Manually assign a team to a group.
    Validates: no duplicate assignment.
  */
  var player = getPlayer(teamId);
  if (!player) return false;
  
  // Remove from old group if present
  Object.keys(groups).forEach(function(gl) {
    var idx = groups[gl].indexOf(teamId);
    if (idx > -1) groups[gl].splice(idx, 1);
  });
  
  // Add to new group
  if (!groups[groupLetter]) groups[groupLetter] = [];
  if (groups[groupLetter].indexOf(teamId) === -1) {
    groups[groupLetter].push(teamId);
  }
  
  player.group = groupLetter;
  return true;
}

function validateGroupAssignment() {
  /*
    Verify: all teams assigned, no duplicates, reasonably balanced.
  */
  var allAssigned = [];
  var duplicates = [];
  
  Object.keys(groups).forEach(function(letter) {
    groups[letter].forEach(function(tid) {
      if (allAssigned.indexOf(tid) > -1) {
        duplicates.push(tid);
      }
      allAssigned.push(tid);
    });
  });
  
  if (duplicates.length > 0) {
    console.warn('Duplicate team assignments:', duplicates);
    return false;
  }
  
  var unassigned = players.filter(function(p) { return !p.group; });
  if (unassigned.length > 0) {
    console.warn('Unassigned teams:', unassigned);
    return false;
  }
  
  return true;
}

/* =====================================================
   GROUP STAGE MODULE
===================================================== */

function generateGroupMatches() {
  /*
    Create round-robin matches within each group.
    Sets: match.stage = 'group', match.stageRound
  */
  var groupMatches = [];
  var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
  
  Object.keys(groups).forEach(function(groupLetter) {
    var teamIds = groups[groupLetter];
    var round = 1;
    
    // Round-robin: each team plays each other
    for (var i = 0; i < teamIds.length; i++) {
      for (var j = i + 1; j < teamIds.length; j++) {
        var match = {
          id: matchIdStart++,
          round: round,
          stage: 'group',
          stageRound: round,
          groupLetter: groupLetter,
          player1: teamIds[i],
          player2: teamIds[j],
          winner: null,
          completed: false,
          bye: false,
          court: null,
          p1Points: 0,
          p2Points: 0,
          p1PD: 0,
          p2PD: 0,
          type: 'normal'
        };
        groupMatches.push(match);
      }
      round++;
    }
  });
  
  return groupMatches;
}

function rankPlayersInGroup(groupLetter) {
  /*
    Rank teams in a group by:
    1. Wins
    2. Point Difference (PF - PA)
    3. Points Against (lower better)
    4. Points For (higher better)
    5. Admin tiebreak (if still tied)
    
    Returns: [p1, p2, p3, ...] sorted by rank within group.
  */
  var teamIds = groups[groupLetter] || [];
  var stats = {};
  
  // Collect stats for each team in group
  teamIds.forEach(function(tid) {
    var p = getPlayer(tid);
    if (!p) return;
    stats[tid] = {
      playerId: tid,
      player: p,
      wins: 0,
      losses: 0,
      pf: 0,
      pa: 0
    };
  });
  
  // Count wins/losses and points from group matches
  matches.forEach(function(m) {
    if (m.stage !== 'group' || m.groupLetter !== groupLetter || !m.completed) return;
    
    var p1Stats = stats[m.player1];
    var p2Stats = stats[m.player2];
    if (!p1Stats || !p2Stats) return;
    
    var p1Pts = m.p1Points || 0;
    var p2Pts = m.p2Points || 0;
    
    p1Stats.pf += p1Pts;
    p1Stats.pa += p2Pts;
    p2Stats.pf += p2Pts;
    p2Stats.pa += p1Pts;
    
    if (m.winner === m.player1) {
      p1Stats.wins++;
      p2Stats.losses++;
    } else if (m.winner === m.player2) {
      p2Stats.wins++;
      p1Stats.losses++;
    }
  });
  
  // Sort by ranking rules
  var sorted = Object.values(stats).sort(function(a, b) {
    // Wins (descending)
    if (a.wins !== b.wins) return b.wins - a.wins;
    
    // Point Difference (descending)
    var aPD = a.pf - a.pa;
    var bPD = b.pf - b.pa;
    if (aPD !== bPD) return bPD - aPD;
    
    // Points Against (ascending, lower is better)
    if (a.pa !== b.pa) return a.pa - b.pa;
    
    // Points For (descending)
    if (a.pf !== b.pf) return b.pf - a.pf;
    
    // Still tied: admin decides
    return 0;
  });
  
  // Check for remaining ties and assign ranks
  var ranked = [];
  var currentRank = 1;
  for (var i = 0; i < sorted.length; i++) {
    var entry = sorted[i];
    
    // Check if tied with previous entry
    if (i > 0) {
      var prev = sorted[i - 1];
      if (entry.wins === prev.wins &&
          (entry.pf - entry.pa) === (prev.pf - prev.pa) &&
          entry.pa === prev.pa &&
          entry.pf === prev.pf) {
        // TIED - require admin tiebreak
        if (!entry.player.manualTiebreakResolved) {
          // Mark for admin resolution
          console.log('Tie detected between:', entry.playerId, 'and', prev.playerId);
        }
      }
    }
    
    entry.player.groupRank = currentRank;
    ranked.push(entry.player);
    currentRank++;
  }
  
  return ranked;
}

function checkGroupTiebreak(groupLetter, team1Id, team2Id) {
  /*
    Detect if two teams are tied in ranking.
    Returns true if they are tied after all automated rules.
  */
  var t1 = getPlayer(team1Id);
  var t2 = getPlayer(team2Id);
  if (!t1 || !t2) return false;
  
  // Recalculate stats for both
  var calcStats = function(tid) {
    var stats = { wins: 0, losses: 0, pf: 0, pa: 0 };
    matches.forEach(function(m) {
      if (m.stage !== 'group' || m.groupLetter !== groupLetter || !m.completed) return;
      if (m.player1 !== tid && m.player2 !== tid) return;
      
      var ptsFor = (m.player1 === tid) ? (m.p1Points || 0) : (m.p2Points || 0);
      var ptsAgn = (m.player1 === tid) ? (m.p2Points || 0) : (m.p1Points || 0);
      
      stats.pf += ptsFor;
      stats.pa += ptsAgn;
      
      if (m.winner === tid) {
        stats.wins++;
      } else if (m.winner !== null) {
        stats.losses++;
      }
    });
    return stats;
  };
  
  var s1 = calcStats(team1Id);
  var s2 = calcStats(team2Id);
  
  // Check if tied on all criteria
  if (s1.wins === s2.wins &&
      (s1.pf - s1.pa) === (s2.pf - s2.pa) &&
      s1.pa === s2.pa &&
      s1.pf === s2.pf) {
    return true;
  }
  
  return false;
}

/* =====================================================
   BYE HANDLING MODULE
===================================================== */

function calculateBYEs(teamCount) {
  /*
    Determine if knockout bracket needs BYEs.
    Returns: { byeCount: N, firstRoundPlayCount: M, isPowerOfTwo: bool }
    
    Example: 8 teams → no BYEs
             7 teams → 1 BYE, 6 play in first round
             9 teams → 7 BYEs needed to reach 16 (or use 1 BYE + 8 play)
  */
  
  // Find next power of 2
  var nextPowerOf2 = 1;
  while (nextPowerOf2 < teamCount) nextPowerOf2 *= 2;
  
  var isPowerOfTwo = (nextPowerOf2 === teamCount);
  var byeCount = isPowerOfTwo ? 0 : (nextPowerOf2 - teamCount);
  var firstRoundPlayCount = teamCount - byeCount;
  
  return {
    byeCount: byeCount,
    firstRoundPlayCount: firstRoundPlayCount,
    isPowerOfTwo: isPowerOfTwo,
    nextPowerOf2: nextPowerOf2
  };
}

function assignBYEs(knockoutTeams) {
  /*
    Assign BYEs to highest seeds.
    knockoutTeams: [p1 (seed 1), p2 (seed 2), ...] ordered by seed
    
    Creates pseudo-matches with bye: true
    These auto-advance in next round.
  */
  var byeInfo = calculateBYEs(knockoutTeams.length);
  var byeMatches = [];
  var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
  
  // Top seeds get BYEs
  for (var i = 0; i < byeInfo.byeCount; i++) {
    var team = knockoutTeams[i];
    var match = {
      id: matchIdStart++,
      round: 1,
      stage: 'knockout',
      stageRound: 1,
      player1: team.id,
      player2: null,
      winner: team.id,  // Auto-advanced
      completed: true,
      bye: true,
      court: null,
      type: 'bye',
      logEntry: {
        type: 'bye_advancement',
        team: team.id,
        timestamp: Date.now()
      }
    };
    byeMatches.push(match);
    team.hasBye = true;
  }
  
  return byeMatches;
}

/* =====================================================
   KNOCKOUT MODULE
===================================================== */

function seedKnockoutTeams(groupRanks) {
  /*
    Seed knockout teams avoiding same-group rematches.
    groupRanks: { 'A': [p1, p2], 'B': [p1, p2], ... }
    
    Interleave to create seeds: A1, B1, C1, D1, A2, B2, C2, D2...
    
    Returns: [seed1, seed2, ..., seed8] for 8-team knockout
  */
  var seeds = [];
  var maxRank = 0;
  Object.keys(groupRanks).forEach(function(g) {
    if (groupRanks[g].length > maxRank) maxRank = groupRanks[g].length;
  });
  
  for (var rank = 0; rank < maxRank; rank++) {
    Object.keys(groupRanks).sort().forEach(function(g) {
      if (groupRanks[g][rank]) {
        seeds.push(groupRanks[g][rank]);
      }
    });
  }
  
  return seeds;
}

function generateKnockoutBracket(qualifyingTeams) {
  /*
    Create single-elimination knockout bracket.
    Seeded: 1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6 (standard 8-team bracket).
    
    Returns: matches[] with stage: 'knockout'
  */
  var knockoutMatches = [];
  var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
  
  // Handle BYEs first
  var byeInfo = calculateBYEs(qualifyingTeams.length);
  if (byeInfo.byeCount > 0) {
    var byeMatches = assignBYEs(qualifyingTeams);
    knockoutMatches.push.apply(knockoutMatches, byeMatches);
    matchIdStart += byeMatches.length;
    // Remove bye teams from bracket generation
    qualifyingTeams = qualifyingTeams.slice(byeInfo.byeCount);
  }
  
  // Generate QF matches (standard bracket seeding: 1v8, 4v5, 2v7, 3v6)
  var pairings = [
    [0, qualifyingTeams.length - 1],
    [Math.ceil(qualifyingTeams.length / 2) - 1, Math.ceil(qualifyingTeams.length / 2)]
  ];
  
  if (qualifyingTeams.length >= 4) {
    pairings = [
      [0, qualifyingTeams.length - 1],
      [Math.floor((qualifyingTeams.length - 1) / 2), Math.ceil((qualifyingTeams.length - 1) / 2)],
      [1, qualifyingTeams.length - 2],
      [Math.floor((qualifyingTeams.length - 1) / 2) - 1, Math.ceil((qualifyingTeams.length - 1) / 2) + 1]
    ];
  }
  
  var matchCount = 0;
  for (var i = 0; i < pairings.length && i < qualifyingTeams.length / 2; i++) {
    if (pairings[i][0] >= qualifyingTeams.length || pairings[i][1] >= qualifyingTeams.length) continue;
    
    var match = {
      id: matchIdStart++,
      round: 1,
      stage: 'knockout',
      stageRound: 1,
      player1: qualifyingTeams[pairings[i][0]].id,
      player2: qualifyingTeams[pairings[i][1]].id,
      winner: null,
      completed: false,
      bye: false,
      court: null,
      type: 'normal'
    };
    knockoutMatches.push(match);
    matchCount++;
  }
  
  return knockoutMatches;
}

/* =====================================================
   PLACEMENT BRACKET MODULE
===================================================== */

function progressPlacementBracket(completedMatchId) {
  /*
    When a knockout match completes, potentially create placement bracket matches.
    
    Losers from QF → 5–8 bracket
    Losers from SF → 3rd place match
    Winner of Final → 1st place
  */
  var match = getMatch(completedMatchId);
  if (!match || match.stage !== 'knockout') return [];
  
  var placementMatches = [];
  var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
  var loser = (match.winner === match.player1) ? match.player2 : match.player1;
  
  // Determine bracket round and create appropriate placement match
  if (match.stageRound === 1) {
    // QF loser → 5–8 bracket
    // Create preliminary placement match
    var placementMatch = {
      id: matchIdStart++,
      round: 1,
      stage: 'placement',
      stageRound: 1,
      playerList: [loser],  // Will pair with other QF losers
      winner: null,
      completed: false,
      bye: false,
      court: null,
      type: 'placement'
    };
    placementMatches.push(placementMatch);
  } else if (match.stageRound === 2) {
    // SF loser → 3rd place match
    var placementMatch = {
      id: matchIdStart++,
      round: 1,
      stage: 'placement',
      stageRound: 1,
      player1: loser,
      player2: null,  // Will pair with other SF loser
      winner: null,
      completed: false,
      bye: false,
      court: null,
      type: '3rdPlace'
    };
    placementMatches.push(placementMatch);
  }
  
  return placementMatches;
}

function generatePlacementBrackets() {
  /*
    Create full placement bracket after all knockout rounds.
    Organizes all losers into ranking brackets.
    
    Example (8 teams):
    - QF losers (4) → 5–8 bracket
    - SF losers (2) → 3rd place match
    - Final loser → 2nd place
    - Final winner → 1st place
  */
  var placementMatches = [];
  var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
  
  // Collect all losers by round
  var qfLosers = [];
  var sfLosers = [];
  
  matches.forEach(function(m) {
    if (m.stage !== 'knockout' || !m.completed) return;
    
    var loser = (m.winner === m.player1) ? m.player2 : m.player1;
    
    if (m.stageRound === 1) {
      qfLosers.push(loser);
    } else if (m.stageRound === 2) {
      sfLosers.push(loser);
    }
  });
  
  // Create 5–8 bracket (QF losers play for 5–8 places)
  if (qfLosers.length >= 2) {
    for (var i = 0; i < qfLosers.length - 1; i += 2) {
      var match = {
        id: matchIdStart++,
        round: 1,
        stage: 'placement',
        stageRound: 1,
        player1: qfLosers[i],
        player2: qfLosers[i + 1],
        winner: null,
        completed: false,
        bye: false,
        court: null,
        type: 'placement'
      };
      placementMatches.push(match);
    }
  }
  
  // Create 3rd place match (SF losers)
  if (sfLosers.length === 2) {
    var thirdPlaceMatch = {
      id: matchIdStart++,
      round: 1,
      stage: 'placement',
      stageRound: 2,
      player1: sfLosers[0],
      player2: sfLosers[1],
      winner: null,
      completed: false,
      bye: false,
      court: null,
      type: '3rdPlace'
    };
    placementMatches.push(thirdPlaceMatch);
  }
  
  return placementMatches;
}

/* =====================================================
   LEADERBOARD SCORING MODULE
===================================================== */

function calculateLeaderboardScore(player, totalTeams) {
  /*
    Protected scoring system.
    
    safeGap = (totalTeams × maxBonusPerMatch) + 1
    basePoints = (totalTeams - finalRank + 1) × safeGap
    finalScore = basePoints + bonusPoints
    
    Final rank ALWAYS overrides bonuses.
  */
  var maxBonusPerMatch = 10;
  var safeGap = (totalTeams * maxBonusPerMatch) + 1;
  
  var finalRank = player.finalRank || totalTeams + 1;
  var basePoints = (totalTeams - finalRank + 1) * safeGap;
  
  player.basePoints = basePoints;
  player.leaderboardScore = basePoints + (player.bonusPoints || 0);
  
  return player.leaderboardScore;
}

function awardBonuses(winnerId, stage) {
  /*
    Award bonus points for match wins in each stage.
    
    Stages:
    - group: +5
    - knockout: +8
    - final: +15
    - placement: +3
    - bye: +0
  */
  var player = getPlayer(winnerId);
  if (!player) return;
  
  var bonusMap = {
    'group': 5,
    'knockout': 8,
    'final': 15,
    'placement': 3,
    'bye': 0
  };
  
  var bonus = bonusMap[stage] || 0;
  player.bonusPoints = (player.bonusPoints || 0) + bonus;
}

function calculateFinalStandings() {
  /*
    Rank all players by:
    1. Final tournament rank (1st, 2nd, etc.)
    2. If not ranked yet, by leaderboard score
    
    Ensures ALL players get a finalRank (no exceptions).
  */
  var totalTeams = players.length;
  
  // Ensure all players have finalRank
  players.forEach(function(p, idx) {
    if (!p.finalRank) {
      // Assign based on elimination round
      // Default: rank after leaderboard score
      p.finalRank = idx + 1;
    }
    calculateLeaderboardScore(p, totalTeams);
  });
  
  // Sort by finalRank
  var standings = players.slice().sort(function(a, b) {
    return a.finalRank - b.finalRank;
  });
  
  return standings;
}

/* =====================================================
   TIEBREAK RESOLUTION MODULE
===================================================== */

function showTiebreakModal(groupLetter, team1Id, team2Id) {
  /*
    Display admin modal to resolve tied teams in group ranking.
    Options:
    1. Direct admin decision (select winner)
    2. Confirm decider match (play short playoff)
  */
  var t1 = getPlayer(team1Id);
  var t2 = getPlayer(team2Id);
  
  if (!t1 || !t2) return;
  
  var modalTitle = 'Group ' + groupLetter + ' Tiebreak';
  var modalBody = 'Teams tied in ranking:\n' + t1.name + ' vs ' + t2.name + '\n\nChoose resolution method:';
  
  // Create custom modal with two action buttons
  var backdrop = document.getElementById('modalBackdrop');
  document.getElementById('modalTitle').textContent = modalTitle;
  document.getElementById('modalBody').textContent = modalBody;
  
  var actionsDiv = document.querySelector('.modal-actions');
  actionsDiv.innerHTML = '';
  
  var deciderBtn = document.createElement('button');
  deciderBtn.textContent = '⚔ Suggest Decider Match';
  deciderBtn.className = 'modal-confirm';
  deciderBtn.onclick = function() {
    closeModal();
    recordAdminDecision(groupLetter, team1Id, team2Id, 'decider');
  };
  
  var directBtn = document.createElement('button');
  directBtn.textContent = 'Admin Decides: ' + t1.name;
  directBtn.className = 'modal-confirm';
  directBtn.onclick = function() {
    closeModal();
    recordAdminDecision(groupLetter, team1Id, team2Id, 'direct', team1Id);
  };
  
  var directBtn2 = document.createElement('button');
  directBtn2.textContent = 'Admin Decides: ' + t2.name;
  directBtn2.className = 'modal-confirm';
  directBtn2.onclick = function() {
    closeModal();
    recordAdminDecision(groupLetter, team1Id, team2Id, 'direct', team2Id);
  };
  
  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'modal-cancel';
  cancelBtn.onclick = closeModal;
  
  actionsDiv.appendChild(directBtn);
  actionsDiv.appendChild(directBtn2);
  actionsDiv.appendChild(deciderBtn);
  actionsDiv.appendChild(cancelBtn);
  
  backdrop.classList.remove('hidden');
}

function recordAdminDecision(groupLetter, team1Id, team2Id, method, selectedWinnerId) {
  /*
    Log admin tiebreak decision.
    Does NOT modify underlying stats (wins/losses/PF/PA).
    Only updates groupRank.
    
    method: 'direct' | 'decider'
    selectedWinnerId: (for 'direct' method only)
  */
  var t1 = getPlayer(team1Id);
  var t2 = getPlayer(team2Id);
  
  if (!t1 || !t2) return;
  
  var logEntry = {
    type: 'manual_tiebreak',
    group: groupLetter,
    tiedTeams: [team1Id, team2Id],
    method: method,
    selectedWinner: selectedWinnerId || null,
    timestamp: Date.now()
  };
  
  if (method === 'direct' && selectedWinnerId) {
    // Winner gets rank 1, loser gets rank 2 (in their tied position)
    var winner = getPlayer(selectedWinnerId);
    var loser = (selectedWinnerId === team1Id) ? t2 : t1;
    winner.manualTiebreakResolved = true;
    winner.groupRank = (winner.groupRank || 99) - 1;
    loser.manualTiebreakResolved = true;
    loser.groupRank = (loser.groupRank || 99);
  } else if (method === 'decider') {
    // Create a short playoff match
    var matchIdStart = (matches.length > 0) ? Math.max.apply(Math, matches.map(function(m) { return m.id; })) + 1 : 1;
    var deciderMatch = {
      id: matchIdStart,
      round: 999,
      stage: 'group',
      stageRound: 999,
      groupLetter: groupLetter,
      player1: team1Id,
      player2: team2Id,
      winner: null,
      completed: false,
      bye: false,
      court: null,
      type: 'tiebreaker',
      logEntry: logEntry
    };
    matches.push(deciderMatch);
  }
  
  // Store log
  if (!t1.tiebreakLog) t1.tiebreakLog = [];
  if (!t2.tiebreakLog) t2.tiebreakLog = [];
  t1.tiebreakLog.push(logEntry);
  t2.tiebreakLog.push(logEntry);
  
  saveState();
}

/* =====================================================
   INTEGRATION HELPERS
===================================================== */

function getMatch(matchId) {
  for (var i = 0; i < matches.length; i++) {
    if (matches[i].id === matchId) return matches[i];
  }
  return null;
}

function getPlayer(playerId) {
  for (var i = 0; i < players.length; i++) {
    if (players[i].id === playerId) return players[i];
  }
  return null;
}

function esc(str) {
  /*
    HTML escape helper for safe string display.
  */
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
