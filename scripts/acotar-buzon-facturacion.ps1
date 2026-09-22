# ============================================================================
# Acota el permiso Mail.Read de la app a UN SOLO buzón.
#
# Por qué existe: para que Compras Adelante pueda leer facturacion@adelantedesarrollos.com
# hay que darle a su registro de app el permiso Mail.Read de APLICACIÓN. Ese permiso,
# tal cual, deja leer TODOS los buzones de la empresa. La ApplicationAccessPolicy es
# lo que lo encierra en un solo buzón, y por eso se corre ANTES de dar el
# consentimiento en Entra.
#
# Se corre UNA vez. Es idempotente: si el grupo o la política ya existen, no los
# vuelve a crear.
#
#   pwsh -File scripts/acotar-buzon-facturacion.ps1
#
# Pide iniciar sesión en el navegador con una cuenta que sea administrador de
# Exchange. Después de correrlo, falta un solo paso y es en el portal de Entra:
# dar "Grant admin consent" al permiso Mail.Read.
# ============================================================================

$ErrorActionPreference = "Stop"

$AppId  = "537458c2-863e-4d4a-87da-06a56a9b411e"   # BusinessCentral_API_Adelante (el que usa compras)
$Buzon  = "facturacion@adelantedesarrollos.com"
$Grupo  = "sg-buzon-facturacion@adelantedesarrollos.com"

Write-Host ""
Write-Host "Conectando a Exchange Online — se va a abrir el navegador para que inicies sesión." -ForegroundColor Cyan
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -ShowBanner:$false

try {
  # --- 1. El grupo que define el alcance -------------------------------------
  # La política apunta a un grupo de seguridad con correo, no al buzón directo:
  # es lo que Exchange acepta de forma confiable. El grupo lleva UN solo miembro.
  $g = Get-DistributionGroup -Identity $Grupo -ErrorAction SilentlyContinue
  if ($null -eq $g) {
    Write-Host "Creando el grupo de alcance $Grupo…" -ForegroundColor Cyan
    New-DistributionGroup -Name "SG Buzon Facturacion" `
      -PrimarySmtpAddress $Grupo -Type Security -Members $Buzon | Out-Null
    Write-Host "  grupo creado." -ForegroundColor Green
  } else {
    Write-Host "El grupo $Grupo ya existía." -ForegroundColor Yellow
    $miembros = Get-DistributionGroupMember -Identity $Grupo | Select-Object -ExpandProperty PrimarySmtpAddress
    if ($miembros -notcontains $Buzon) {
      Add-DistributionGroupMember -Identity $Grupo -Member $Buzon
      Write-Host "  se le agregó $Buzon." -ForegroundColor Green
    }
  }

  # --- 2. La política ---------------------------------------------------------
  $pol = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue |
         Where-Object { $_.AppId -eq $AppId }
  if ($null -eq $pol) {
    Write-Host "Creando la politica que encierra la app en ese buzon…" -ForegroundColor Cyan
    New-ApplicationAccessPolicy -AppId $AppId -PolicyScopeGroupId $Grupo `
      -AccessRight RestrictAccess `
      -Description "Compras Adelante: solo el buzon de facturacion" | Out-Null
    Write-Host "  politica creada." -ForegroundColor Green
  } else {
    Write-Host "La politica para esa app ya existia ($($pol.AccessRight))." -ForegroundColor Yellow
  }

  # --- 3. La prueba -----------------------------------------------------------
  # Exchange tarda en propagar (a veces media hora). Si acá dice Denied justo
  # despues de crear la politica, no es que este mal: es que todavia no propago.
  Write-Host ""
  Write-Host "Probando el acceso…" -ForegroundColor Cyan
  $ok = Test-ApplicationAccessPolicy -Identity $Buzon -AppId $AppId
  Write-Host "  $($Buzon)  ->  $($ok.AccessCheckResult)"

  $otro = Get-Mailbox -ResultSize 5 |
          Where-Object { $_.PrimarySmtpAddress -ne $Buzon } |
          Select-Object -First 1
  if ($otro) {
    $no = Test-ApplicationAccessPolicy -Identity $otro.PrimarySmtpAddress -AppId $AppId
    Write-Host "  $($otro.PrimarySmtpAddress)  ->  $($no.AccessCheckResult)  (tiene que decir Denied)"
  }

  Write-Host ""
  Write-Host "Listo. Falta UN paso y es en el portal:" -ForegroundColor Green
  Write-Host "  Entra > App registrations > BusinessCentral_API_Adelante > API permissions"
  Write-Host "  > Add a permission > Microsoft Graph > Application permissions > Mail.Read"
  Write-Host "  > Add, y despues el boton 'Grant admin consent for Adelante Desarrollos'."
  Write-Host ""
}
finally {
  Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
}
