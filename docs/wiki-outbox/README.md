# Wiki outbox

Bandeja de salida transitoria para la documentacion que vive en la wiki de OS (`wiki/`). No es un lugar de guardado: cada merge a `main` abre un pull request contra OS con lo que haya aca y despues vacia la bandeja. Un articulo que sigue aca despues de un merge es un error, no un patron.

> **Para el equipo:** ver [`CLAUDE.md`](../CLAUDE.md#customer-facing-documentation-docswiki-outbox) para las reglas de cuando crear o actualizar un articulo.

## Disposicion

La bandeja refleja la forma de la wiki, asi el destino de cada articulo no se discute:

- `docs/wiki-outbox/product/features/mi-funcion.md` llega a `wiki/product/features/mi-funcion.md` en OS.
- `docs/wiki-outbox/_retract/<nombre>.md` propone eliminar un articulo de la wiki (ver Retiros abajo).

Solo se prepara contenido de `wiki/product/` (instalacion del agente, configuracion de impresoras, solucion de problemas). El material de `wiki/market/` se edita directo en OS porque no documenta un cambio de codigo.

## Frontmatter de cada articulo

```markdown
---
title: Titulo legible
updated: 2026-09-22
audience: cliente
payload_slug: features/mi-funcion
---
```

- `title`, `updated`, `audience`, `payload_slug`: obligatorios. El pull request falla sin ellos.
- `audience` vale siempre `cliente`. Sin esa clave el sincronizador ignora el archivo en silencio, asi que el chequeo la exige.
- `payload_slug` es la identidad del articulo: la ruta bajo `wiki/product/` sin extension. Tiene que coincidir con la ruta del archivo en esta bandeja. Si renombras el archivo, actualiza la clave en el mismo cambio.

El cuerpo sigue la forma de articulo de siempre (resumen en una linea, por que importa, pasos de uso, consejos y preguntas, relacionado). Los indices y cross-links de la wiki los mantiene el curador de OS al recibir el pull request; no hace falta editarlos aca.

## Retiros

Cuando un cambio quita un comportamiento documentado, el mismo pull request trae una tumba que nombra la identidad:

```markdown
---
payload_slug: features/funcion-eliminada
reason: La funcion se quito en la version 3.2 y el articulo ya no describe nada real.
---
```

El archivo vive en `docs/wiki-outbox/_retract/` con cualquier nombre. El curador revisa el retiro igual que un articulo y el sincronizador da de baja el documento correspondiente en el sitio.

## Que pasa al hacer merge

1. El workflow `publish-wiki-outbox` valida la bandeja, abre un pull request contra OS con los articulos y vacia la bandeja en este repo.
2. El curador de OS revisa ese pull request, ubica o reconcilia cada articulo y lo mergea a la wiki.
3. El push a OS sincroniza los articulos con `audience: cliente` al sitio como borradores pendientes de aprobacion.

Un pull request que se cierra sin mergear no propone nada a OS y no requiere limpieza.
