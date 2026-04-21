const fs = require('fs');
const path = require('path');

const logPath = process.argv[2]
  || path.join(__dirname, '..', 'logs', 'pipeline_failure.log');
const outputPath = path.join(__dirname, '..', 'artifacts', 'incident_report.md');
const outputJsonPath = outputPath.replace('.md', '.json');

// ── Análisis local (sin IA) como fallback ──────────────────────────
function analyzeLocally(logContent) {
  const lower = logContent.toLowerCase();

  if (lower.includes('expected: 200') && lower.includes('received: 500')) {
    return {
      step_failed: 'Unit Tests',
      probable_cause: 'El endpoint /health devuelve 500 porque APP_ENV no está definida en el ambiente de tests.',
      confidence: 'High',
      severity: 'medium',
      suggested_fix: 'Agregar APP_ENV=test en el beforeAll() del archivo de tests, o configurarlo en el workflow.',
      rollback_required: false,
      recommended_action: 'Corregir el archivo de tests y volver a correr el pipeline.'
    };
  }

  if (lower.includes('connection refused') || lower.includes('econnrefused')) {
    return {
      step_failed: 'Health Check / Smoke Test',
      probable_cause: 'El contenedor no arrancó correctamente o está en el puerto equivocado.',
      confidence: 'High',
      severity: 'high',
      suggested_fix: 'Verificar que el Dockerfile expone el puerto correcto y que APP_ENV está configurada.',
      rollback_required: true,
      recommended_action: 'Revisar logs del contenedor con: docker logs app-staging'
    };
  }

  return {
    step_failed: 'Desconocido',
    probable_cause: 'No se pudo determinar la causa raíz con los logs disponibles.',
    confidence: 'Low',
    severity: 'medium',
    suggested_fix: 'Revisar los logs del pipeline manualmente.',
    rollback_required: false,
    recommended_action: 'Inspeccionar los logs en la pestaña Actions de GitHub.'
  };
}

// ── Análisis con la API de Claude ─────────────────────────────────
async function analyzeWithAI(logContent) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.log('No se encontró ANTHROPIC_API_KEY — usando análisis local...');
    return analyzeLocally(logContent);
  }

  try {
    console.log('Llamando a la API de Claude para analizar el incidente...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Sos un experto en CI/CD y DevOps. Analizá estos logs de falla de un pipeline y devolvé SOLO un objeto JSON (sin texto extra, sin backticks, sin markdown):

${logContent}

Devolvé exactamente esta estructura JSON:
{
  "step_failed": "nombre del paso que falló",
  "probable_cause": "explicación detallada de qué salió mal",
  "confidence": "High o Medium o Low",
  "severity": "critical o high o medium o low",
  "suggested_fix": "pasos concretos para solucionar el problema",
  "rollback_required": true o false,
  "recommended_action": "qué hacer a continuación"
}`
        }]
      })
    });

    const data = await response.json();
    const text = data.content[0].text.trim()
      .replace(/```json\n?|\n?```/g, '').trim();

    return JSON.parse(text);
  } catch (err) {
    console.error('Error llamando a la API, usando análisis local:', err.message);
    return analyzeLocally(logContent);
  }
}

// ── Generar el reporte en Markdown ────────────────────────────────
function generateMarkdown(analysis) {
  const icons = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const icon = icons[analysis.severity] || '⚪';

  return `# Incident Report

**Generado:** ${new Date().toISOString()}

---

## Resumen

| Campo | Valor |
|---|---|
| **Paso fallido** | ${analysis.step_failed} |
| **Severidad** | ${icon} ${analysis.severity.toUpperCase()} |
| **Confianza del análisis** | ${analysis.confidence} |
| **Rollback requerido** | ${analysis.rollback_required ? '✅ SÍ' : '❌ No'} |

---

## Causa probable

${analysis.probable_cause}

---

## Cómo solucionarlo

${analysis.suggested_fix}

---

## Acción recomendada

${analysis.recommended_action}
`;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  let logContent = '';
  try {
    logContent = fs.readFileSync(logPath, 'utf8');
    console.log(`Logs leídos desde: ${logPath}`);
  } catch {
    console.log('No se encontró archivo de logs, usando mensaje genérico.');
    logContent = 'Pipeline failed. No detailed logs available.';
  }

  const analysis = await analyzeWithAI(logContent);
  const markdown = generateMarkdown(analysis);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  fs.writeFileSync(outputJsonPath, JSON.stringify(analysis, null, 2));

  console.log(`\nReporte generado en: ${outputPath}`);
  console.log('\n══ PREVIEW DEL REPORTE ══');
  console.log(markdown);
}

main().catch(console.error);