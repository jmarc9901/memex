## Qué cambia

<!-- Una o dos frases. Si arregla una issue, enlázala: "Cierra #12". -->

## Por qué

<!-- El problema real que resuelve. Si toca el ranking, di qué mejora. -->

## Cómo lo he comprobado

- [ ] `npm run check` en verde
- [ ] `npm test` en verde
- [ ] Si toca búsqueda, ranking o indexado: mirado `test/quality.test.js` y, si
      aplica, añadido el caso a su corpus etiquetado
- [ ] Si añade un módulo nuevo: incluye su `test/<modulo>.test.js`
- [ ] Si cambia el comportamiento visible: anotado en `CHANGELOG.md` ("Sin publicar")
- [ ] Sin dependencias nuevas (regla cero; ver [CONTRIBUTING.md](../CONTRIBUTING.md))
- [ ] Si cambia un README, el otro idioma queda sincronizado
- [ ] Si cambia la API HTTP o los módulos/invariantes, actualizados
      `docs/API.md` y/o `docs/ARQUITECTURA.md`

## Notas para quien revisa

<!-- Decisiones discutibles, efectos secundarios, lo que NO cubre este PR. -->
