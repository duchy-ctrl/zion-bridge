# Zion Bridge — worker COM pentru casa Datecs prin DUDE (dude.CFD_DUDE).
#
# De ce există: Electron (Node) nu vorbește COM nativ fără module compilate (winax cere
# Visual Studio Build Tools și pică des la instalare). PowerShell vorbește COM nativ pe
# orice Windows, deci procesul principal pornește acest worker ASCUNS și comunică cu el
# prin linii JSON pe stdin/stdout. Fiecare cerere are un "id"; răspunsul poartă același id.
#
# Comenzi:
#   {"id":1,"cmd":"ping"}
#   {"id":2,"cmd":"open","mode":"tcp","ip":"192.168.0.71","port":3999}
#   {"id":2,"cmd":"open","mode":"serial","com":"COM3","baud":115200}
#   {"id":3,"cmd":"exec","num":48,"params":"1\t0001\t1\t"}
#   {"id":4,"cmd":"close"}
# Răspuns: {"id":N,"ok":true/false,"rc":<cod>,"err":"...","answer":"...","lastError":<cod>}

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::InputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$dude = $null
$connected = $false

function Send-Reply($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Read-AnswerList($o) {
  # last_AnswerList: răspunsul aparatului (linii CRLF; primul câmp = cod eroare)
  try { return [string]$o.last_AnswerList } catch { return '' }
}

function Read-LastError($o) {
  try { return [int]$o.lastError_Code } catch { return 0 }
}

function Read-LastMessage($o) {
  # mesajul text al ultimei erori, din dicționarul driverului
  try { return [string]$o.lastError_Message } catch { return '' }
}

function Read-StatusFlags($o) {
  # citește biții de stare ai casei și întoarce doar pe cei activi, ca text scurt.
  # Acoperă cauzele tipice de refuz: hârtie, bon rămas deschis, „trebuie Z", capac etc.
  $map = [ordered]@{
    'hartie_terminata'      = 'eSBit_EndOfPaper'
    'eroare_sintaxa'        = 'eSBit_SyntaxError'
    'comanda_nepermisa'     = 'eSBit_CommandNotPermitted'
    'cod_comanda_invalid'   = 'eSBit_CommandCodeIsInvalid'
    'depasire_valoare'      = 'eSBit_Overflow'
    'memorie_fiscala_plina' = 'eSBit_FM_Full'
    'jurnal_electronic_plin'= 'eSBit_EJIsFull'
    'ceas_nesincronizat'    = 'eSBit_ClockIsNotSynchronized'
    'eroare_mecanism_print' = 'eSBit_PrintingMechanism'
    'capac_deschis'         = 'iSBit_Cover_IsOpen'
    'trebuie_raport_Z_24h'  = 'iSBit_24h_AfterDayOpening'
    'bon_fiscal_deschis'    = 'iSBit_Receipt_Fiscal'
    'bon_nefiscal_deschis'  = 'iSBit_Receipt_Nonfiscal'
    'aproape_fara_hartie'   = 'iSBit_Near_PaperEnd'
  }
  $flags = @()
  foreach ($k in $map.Keys) {
    try { if ($o.($map[$k])) { $flags += $k } } catch {}
  }
  return ($flags -join ', ')
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }          # părintele a închis stdin → ieșim curat
  $line = $line.Trim()
  if ($line.Length -eq 0) { continue }

  $req = $null
  try { $req = $line | ConvertFrom-Json } catch {
    Send-Reply @{ id = -1; ok = $false; err = "JSON invalid: $line" }
    continue
  }

  $reply = @{ id = $req.id; ok = $false; rc = $null; err = ''; answer = ''; lastError = 0; errMsg = ''; status = '' }

  try {
    switch ($req.cmd) {

      'ping' {
        $reply.ok = $true
        $reply.answer = 'pong'
      }

      'detect' {
        # verifică dacă DUDE e instalat (fără să deschidă conexiunea)
        $t = $null
        try { $t = [type]::GetTypeFromProgID('dude.CFD_DUDE') } catch {}
        if ($null -ne $t) { $reply.ok = $true; $reply.answer = 'dude.CFD_DUDE' }
        else { $reply.err = 'DUDE (dude.CFD_DUDE) nu este instalat pe acest PC' }
      }

      'open' {
        if ($null -eq $dude) {
          try {
            $dude = New-Object -ComObject 'dude.CFD_DUDE'
          } catch {
            throw "Nu pot crea obiectul COM dude.CFD_DUDE - DUDE nu este instalat sau este blocat: $($_.Exception.Message)"
          }
        }
        if ($req.mode -eq 'serial') {
          $comNum = [int]($req.com -replace '\D', '')
          [void]$dude.set_RS232($comNum, [int]$req.baud)
        } else {
          [void]$dude.set_TCPIP([string]$req.ip, [int]$req.port)
        }
        $rc = [int]$dude.open_Connection()
        $reply.rc = $rc
        $reply.lastError = Read-LastError $dude
        if ($rc -ge 0) {
          $connected = $true
          $reply.ok = $true
        } else {
          $connected = $false
          $reply.err = "open_Connection a esuat (rc=$rc). Cauze tipice: casa oprita, IP/port gresit, sau ALT PROGRAM tine deja conexiunea (portul casei accepta un singur client)."
        }
      }

      'exec' {
        if ($null -eq $dude -or -not $connected) { throw 'Conexiunea cu casa nu este deschisa' }
        # DUDE expune execute_Command(int command, string input, string input2) — 3 argumente.
        # Al treilea câmp de intrare se trimite gol; răspunsul casei se citește din
        # proprietatea last_AnswerList (vezi Read-AnswerList), nu din valoarea returnată.
        $rc = [int]$dude.execute_Command([int]$req.num, [string]$req.params, '')
        $reply.rc = $rc
        $reply.answer = Read-AnswerList $dude
        $reply.lastError = Read-LastError $dude
        $reply.errMsg = Read-LastMessage $dude
        $reply.status = Read-StatusFlags $dude
        $reply.ok = $true   # ok = comanda a fost trimisă; codul de eroare se interpretează în Node
      }

      'close' {
        if ($null -ne $dude -and $connected) {
          try { [void]$dude.close_Connection() } catch {}
        }
        $connected = $false
        $reply.ok = $true
      }

      'quit' {
        if ($null -ne $dude -and $connected) { try { [void]$dude.close_Connection() } catch {} }
        Send-Reply @{ id = $req.id; ok = $true }
        exit 0
      }

      default { $reply.err = "Comanda necunoscuta: $($req.cmd)" }
    }
  } catch {
    $reply.ok = $false
    $reply.err = $_.Exception.Message
    # dacă a crăpat conexiunea, marcăm ca închisă ca să forțăm re-open la următorul ciclu
    if ($req.cmd -eq 'exec') { $connected = $false }
  }

  Send-Reply $reply
}

# stdin închis: curățenie
if ($null -ne $dude -and $connected) { try { [void]$dude.close_Connection() } catch {} }
exit 0
