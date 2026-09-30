# Security Policy

## Versiones soportadas

Solo la última versión publicada de VANTCALL Desktop recibe parches de seguridad.

| Versión | Soporte de seguridad |
| ------- | -------------------- |
| última release | ✅ |
| anteriores | ❌ |

Recomendamos mantener el auto-updater activado para recibir los parches automáticamente.

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad en VANTCALL Desktop, VANTS o la infraestructura asociada:

- **No** abras un issue público.
- **No** publiques detalles en Discord, redes sociales ni foros.
- Escribe a **security@vants.gg** con:
  - Descripción de la vulnerabilidad.
  - Pasos para reproducirla.
  - Impacto potencial.
  - Versión afectada (`Ajustes → Acerca de` en el Desktop).
  - Tu contacto para el seguimiento.

## Qué esperar

- Confirmación de recepción en **72 horas**.
- Evaluación inicial y clasificación en **7 días**.
- Comunicación del plan de mitigación y fecha estimada de parche.
- Crédito público en las notas de la release, si lo deseas y una vez el parche esté publicado.

## Alcance

Cubierto:

- Clientes oficiales: VANTCALL Desktop (Windows, macOS, Linux).
- Web oficial: vants.gg y subdominios.
- Backend: Supabase y Edge Functions bajo control de VANTS.
- Cadena de release: workflows de GitHub Actions y firma del updater.

No cubierto:

- Ingeniería social o phishing sin vulnerabilidad técnica demostrable.
- Ataques que requieran acceso físico al dispositivo del usuario.
- Denegación de servicio por volumen bruto.
- Vulnerabilidades en dependencias ya reportadas públicamente sin PoC específico contra VANTS.

## Divulgación coordinada

Trabajamos bajo divulgación coordinada. Pedimos un plazo razonable (habitualmente 90 días desde el reporte) antes de publicar detalles técnicos, para proteger a los usuarios de VANTS mientras se despliega el parche.
