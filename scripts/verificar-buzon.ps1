# ============================================================================
# Solo LEE y reporta. No crea ni cambia nada.
#
# Contesta dos cosas:
#   1. ¿Quedó la política que encierra la app en el buzón de facturación?
#   2. ¿Está dando acceso a ese buzón y negándolo en los demás?
#
#   pwsh -File scripts/verificar-buzon.ps1
# ============================================================================

$ErrorActionPreference = "Stop"

$AppId = "537458c2-863e-4d4a-87da-06a56a9b411e"
$Buzon = "facturacion@adelantedesarrollos.com"

Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -ShowBanner:$false

try {
  $pol = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue |
         Where-Object { $_.AppId -eq $AppId }

  if ($null -eq $pol) {
    Write-Host ""
    Write-Host "NO hay politica para esta app." -ForegroundColor Red
    Write-Host "Corre primero: pwsh -File scripts/acotar-buzon-facturacion.ps1"
    Write-Host ""
    return
  }

  Write-Host ""
  Write-Host "Politica encontrada:" -ForegroundColor Green
  Write-Host "  alcance : $($pol.ScopeName)"
  Write-Host "  derecho : $($pol.AccessRight)   (tiene que decir RestrictAccess)"
  Write-Host ""

  $ok = Test-ApplicationAccessPolicy -Identity $Buzon -AppId $AppId
  Write-Host "  $Buzon  ->  $($ok.AccessCheckResult)   (tiene que decir Granted)"

  $otro = Get-Mailbox -ResultSize 5 |
          Where-Object { $_.PrimarySmtpAddress -ne $Buzon } |
          Select-Object -First 1
  if ($otro) {
    $no = Test-ApplicationAccessPolicy -Identity $otro.PrimarySmtpAddress -AppId $AppId
    Write-Host "  $($otro.PrimarySmtpAddress)  ->  $($no.AccessCheckResult)   (tiene que decir Denied)"
  }
  Write-Host ""
}
finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}
