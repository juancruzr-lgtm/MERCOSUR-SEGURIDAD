import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      // Script legacy autoejecutable (imprime su propio RESULTADO al
      // importarse); no exporta suites vitest y haría fallar npm test.
      'tests/horas-liquidables.test.ts',
      // Copias anidadas de proyectos viejos dentro de la carpeta de trabajo.
      '**/mercosur-v5/**',
    ],
  },
})
