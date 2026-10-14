// EVO's live data, for the Academy (the safety rating, and laps the moment they're
// done: EVO writes its log in blocks, many seconds late when little happens on
// track): the shared memory it keeps for third-party tools, read-only. The layout
// is Kunos's (SharedFileOut.h, packed to 4):
//   Local\acevo_pmf_physics   speedKmh (float) at 28, carDamage[5] floats at 224, numberOfTyresOut (int) at 244
//   Local\acevo_pmf_graphics  status (int) at 4 (2: driving), current_lap_time_ms (int) at 188,
//                             npos (float, 0-1 round the lap) at 1244, total_lap_count and
//                             last_laptime_ms (ints) at 2384 and 2396, car_model (char[33]) at 3086,
//                             is_in_pit_box, is_in_pit_lane, is_valid_lap (bools) at 3119-3121
// A PowerShell helper reads them 20 times a second and prints a line of JSON when
//   the car's damage goes up (an impact)                { "t": "hit", "d": how much, over 0.4 s }
//   3 or more wheels were off the track for 0.3 s       { "t": "off", "n": wheels, "cut": the lap marked invalid then }
//     (once the car is back on and 1.5 s more have gone, for EVO to judge the cut)
//   the lap is marked invalid with the wheels on        { "t": "cut" }
//   the graphics page reads as the layout says, or not  { "t": "gfx", "ok": true | false, "why", "car" }
//   the lap's validity changes                          { "t": "valid", "v": 0 | 1 }
//   a lap is done (the lap count went up)               { "t": "lap", "n": laps, "ms": its time, "valid": not marked
//                                                         invalid, "pit": in the pit lane during it, "kmh": speed then }
//   with `pos` (a sprint), each read while driving      { "t": "pos", "n": npos, "ms": the timer }
//     (EVO's live data says nothing at a sprint's finish arch: main.js finds it by
//     where the car is, sprintPos)
// Without a readable graphics page, there are no cuts or laps from here (main.js reads them
// from the log then). It waits for the pages while EVO starts, and ends with the
// launcher or when stopped. It's too long for a command line: it's written to a
// file in the temp folder, which a short command reads and runs.
import { powershellEncodedCommand, psQuote, writeText, join, norm, log } from './util.js';

const script = (name, gfxName, parent, pos) => `
$ErrorActionPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue'
$inv = [Globalization.CultureInfo]::InvariantCulture
$sw = [Diagnostics.Stopwatch]::StartNew()
function Say($json) { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
function Text($v, $at) {
  $b = New-Object byte[] 33; [void]$v.ReadArray($at, $b, 0, 33)
  $n = [Array]::IndexOf($b, [byte]0); if ($n -lt 0) { $n = 33 }
  [Text.Encoding]::ASCII.GetString($b, 0, $n)
}
$view = $null; $last = -1.0; $hit = 0.0; $hitAt = 0; $alive = 0
$offAt = 0; $off = $false; $offN = 0; $offCut = $false; $offEnd = 0
$gview = $null; $gnext = 0; $gok = $null; $valid = -1; $invalid = $false
$laps = -1; $lapMs = 0; $lapAt = 0; $lapN = 0; $lapStart = 0; $lapBad = $false; $lapPit = $false; $wasBad = $false; $wasPit = $false
while ($true) {
  $now = $sw.ElapsedMilliseconds
  if ($now - $alive -ge 2000) {
    $alive = $now
    if (-not (Get-Process -Id ${parent})) { exit }
  }
  if (-not $view) {
    try {
      $map = [IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('${name}', [IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
      $view = $map.CreateViewAccessor(0, 256, [IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
      Say '{"t":"open"}'
    } catch { $view = $null; Start-Sleep -Milliseconds 1000; continue }
  }
  if (-not $gview -and $now -ge $gnext) {
    try {
      $gmap = [IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('${gfxName}', [IO.MemoryMappedFiles.MemoryMappedFileRights]::Read)
      $gview = $gmap.CreateViewAccessor(0, 4096, [IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
    } catch { $gview = $null; $gnext = $now + 1000 }
  }
  # The graphics page, once driving: checked against the layout once, then the lap's validity.
  $driving = $true
  if ($gview) {
    $driving = $gview.ReadInt32(4) -eq 2
    if ($driving -and $null -eq $gok) {
      $car = Text $gview 3086
      $flags = @($gview.ReadByte(3119), $gview.ReadByte(3120), $gview.ReadByte(3121))
      $why = if (-not ($car -match '^[ -~]+$')) { 'no car name at 3086' } elseif (@($flags | Where-Object { $_ -gt 1 }).Count) { 'flags at 3119-3121 not 0/1' } else { '' }
      $gok = -not $why
      Say ('{"t":"gfx","ok":' + $gok.ToString().ToLower() + ',"why":"' + $why + '","car":"' + ($car -replace '[^A-Za-z0-9 _.-]', '') + '"}')
    }
    if ($driving -and $gok) {
      $v = [int]$gview.ReadByte(3121)
      if ($v -ne $valid) {
        if ($valid -ge 0) { Say ('{"t":"valid","v":' + $v + '}') }
        if ($valid -eq 1 -and $v -eq 0) { $invalid = $true }
        $valid = $v
      }
      # Laps: the count going up ends one (its time can come a frame later); going
      # down is a restart. Marked invalid or in the pit lane at any time in it (not
      # just after its line: the flag can lag the count by a frame) goes with it.
      $n = $gview.ReadInt32(2384); $lms = $gview.ReadInt32(2396)
      if ($v -eq 0 -and $now - $lapStart -ge 500) { $lapBad = $true }
      if ($gview.ReadByte(3120)) { $lapPit = $true }
      if ($laps -lt 0 -or $n -lt $laps) { $laps = $n; $lapMs = $lms; $lapAt = 0; $lapBad = $false; $lapPit = $false }
      elseif ($n -gt $laps -and $lapAt -eq 0) {
        $lapAt = $now; $lapStart = $now; $lapN = $n; $laps = $n
        $wasBad = $lapBad; $wasPit = $lapPit; $lapBad = $false; $lapPit = [bool]$gview.ReadByte(3120)
      }
      if ($lapAt -gt 0 -and ($lms -ne $lapMs -or $now - $lapAt -ge 400)) {
        Say ('{"t":"lap","n":' + $lapN + ',"ms":' + $lms + ',"valid":' + (-not $wasBad).ToString().ToLower() + ',"pit":' + $wasPit.ToString().ToLower() + ',"kmh":' + [Math]::Round($view.ReadSingle(28)) + '}')
        $lapMs = $lms; $lapAt = 0
      }
      ${pos ? `$cur = $gview.ReadInt32(188)
      if ($cur -gt 0) { Say ('{"t":"pos","n":' + $gview.ReadSingle(1244).ToString('0.000000', $inv) + ',"ms":' + $cur + '}') }` : ''}
    }
  }
  $dmg = 0.0
  for ($i = 0; $i -lt 5; $i++) { $dmg += $view.ReadSingle(224 + 4 * $i) }
  $out = $view.ReadInt32(244)
  if ($last -ge 0 -and $dmg -gt $last + 0.01 -and $driving) { if ($hit -eq 0) { $hitAt = $now }; $hit += $dmg - $last }
  $last = $dmg
  if ($hit -gt 0 -and $now - $hitAt -ge 400) {
    Say ('{"t":"hit","d":' + [Math]::Round($hit, 3).ToString($inv) + '}'); $hit = 0.0
  }
  # Wheels off: one excursion from 0.3 s off until 1.5 s back on (going off again meanwhile is the same one).
  if ($out -ge 3 -and $driving) {
    if ($off) { $offEnd = 0; if ($out -gt $offN) { $offN = $out } }
    elseif ($offAt -eq 0) { $offAt = $now }
    elseif ($now - $offAt -ge 300) { $off = $true; $offN = $out; $offCut = $false; $offEnd = 0 }
  } else {
    $offAt = 0
    if ($off -and $offEnd -eq 0) { $offEnd = $now }
  }
  if ($invalid) { if ($off) { $offCut = $true } else { Say '{"t":"cut"}' }; $invalid = $false }
  if ($off -and $offEnd -gt 0 -and $now - $offEnd -ge 1500) {
    Say ('{"t":"off","n":' + $offN + ',"cut":' + $offCut.ToString().ToLower() + '}'); $off = $false; $offEnd = 0
  }
  Start-Sleep -Milliseconds 50
}
`;

// Starts the helper; onEvent gets each event. Returns stop(). names: the pages to
// read (others for --check-academy, never EVO's while it runs); pos: the car's place
// on the lap and the timer, for a sprint.
export async function startTelemetry(onEvent, name = 'Local\\acevo_pmf_physics', gfxName = 'Local\\acevo_pmf_graphics', { pos = false } = {}) {
  const file = join(norm(await Neutralino.os.getPath('temp')), 'assetto-launcher-evotelemetry.ps1');
  const text = script(name, gfxName, window.NL_PID, pos);
  await writeText(file, text);
  // The command checks the file is what was written before running it.
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const p = await Neutralino.os.spawnProcess(powershellEncodedCommand(`$ProgressPreference = 'SilentlyContinue'; $b = [IO.File]::ReadAllBytes(${psQuote(file)}); $h = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace('-', ''); if ($h -ne '${sha}') { [Console]::Error.WriteLine('the helper script changed on disk: not run'); exit 1 }; Invoke-Expression ([Text.Encoding]::UTF8.GetString($b))`));
  let rest = '';
  const on = e => {
    if (e.detail.id !== p.id) return;
    if (e.detail.action === 'exit') { Neutralino.events.off('spawnedProcess', on); return; }
    if (e.detail.action !== 'stdOut') { if (e.detail.data) log(`evo telemetry: ${String(e.detail.data).trim()}`); return; }
    const lines = (rest + e.detail.data).split('\n');
    rest = lines.pop();
    for (const line of lines) {
      try { onEvent(JSON.parse(line)); } catch { /* not ours */ }
    }
  };
  Neutralino.events.on('spawnedProcess', on);
  return () => {
    Neutralino.events.off('spawnedProcess', on);
    Neutralino.os.updateSpawnedProcess(p.id, 'exit').catch(() => {});
  };
}
