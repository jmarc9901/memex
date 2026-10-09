La idea que te propongo es Memex Offline: tu propio Google personal, 100% offline, que indexa todo lo que tienes en tu computadora y te permite buscar, preguntar y conectar información como nunca antes.

Es un proyecto ambicioso, pero perfectamente divisible en partes. Y lo mejor: ya tienes varias piezas construidas en tus repos (light, shuttle-codec, Compresor, KARA). Solo tendrías que integrarlas con una visión clara.
🧠 ¿Qué es el Memex?

En 1945, Vannevar Bush describió el Memex: un dispositivo donde una persona almacena todos sus libros, documentos y comunicaciones, y puede consultarlos con velocidad y flexibilidad, creando "trails" (caminos asociativos) entre ellos.

Nunca se realizó completamente. Hoy tenemos la nube, pero está fragmentada, es privativa y depende de internet. Nadie ha construido un Memex moderno, offline, multimodal y de código abierto. Ese es tu hueco.
🎯 ¿Qué haría Memex Offline?

    Indexa todo tu disco: PDFs, TXT, Markdown, código, imágenes (OCR), audio (speech-to-text), video (transcripción), páginas web guardadas, emails.

    Búsqueda full-text + semántica: encuentras por palabras exactas o por significado ("¿dónde hablé de ansiedad?").

    Preguntas en lenguaje natural: "¿Qué conclusiones saqué del proyecto X en 2024?" → responde con citas a tus archivos locales.

    Trails asociativos: creas y compartes caminos entre documentos, como imaginó Bush.

    100% offline: sin nube, sin telemetría, sin GPU obligatoria. Corre en CPU con modelos pequeños.

    Un solo binario / instalador multiplataforma (Windows, Linux, macOS).

🔥 ¿Por qué este proyecto te daría reputación y seguidores?

    Narrativa poderosa: "El Memex olvidado" atrae a Hacker News, Reddit, medios tecnológicos y comunidades de retro-futurismo.

    Dolor universal: todos pierden archivos, todos quieren buscar en su propia información.

    Privacidad: tema candente. La gente desconfía de la nube.

    Técnicamente impresionante: combina OCR, STT, embeddings, LLM, indexación, GUI. Es un imán para contribuidores.

    Open source: con una licencia MIT/Apache, cualquiera puede usarlo, mejorarlo y difundirlo.

🛠️ Roadmap realista (MVP en 3–4 semanas)
Fase	Qué haces	Herramientas
1	CLI que indexa una carpeta de PDFs/TXT y permite búsqueda full-text	Python + SQLite FTS5
2	Añadir OCR para imágenes y PDFs escaneados	Tesseract
3	Añadir transcripción de audio/video	Whisper.cpp (o tu shuttle-codec para extraer audio)
4	Búsqueda semántica con embeddings locales	ONNX Runtime + all-MiniLM-L6-v2
5	Preguntas y respuestas con LLM local + RAG	Tu light o llama.cpp con Phi-3/Qwen2.5-0.5B
6	GUI de escritorio	Tauri + tu KARA o React
7	Trails: grafo de relaciones entre documentos	SQLite + visualización con D3.js
8	Extensión de navegador para guardar páginas	WebExtension API

Con esto ya tendrías algo que nadie ha hecho completo: un Memex offline, multimodal y con LLM local.

🧱 Ruta 1: MVP puro, sin IA (búsqueda full-text y semántica)

Esta es la base del proyecto y no requiere ninguna LLM, ni local ni remota. Funciona completamente offline y con recursos mínimos.
Búsqueda full-text (keyword search)

Es la forma más sencilla y eficaz de empezar. Puedes usar SQLite FTS5, que viene integrado en Python y no necesita instalar nada más.

    gret es una herramienta de código abierto escrita en Node.js que indexa archivos Markdown usando SQLite FTS5, con ranking BM25 y expansión de acrónimos. Es 100% local y no requiere internet. Puedes instalarla con npm install -g @vladimirshefer/gret y probarla con tus propios archivos.

    fidx es una alternativa en Python que va un paso más allá: combina búsqueda por palabras clave (BM25) con búsqueda semántica usando embeddings, todo en un solo archivo SQLite, sin GPU y sin LLM en el proceso de consulta. Según sus benchmarks, responde en 18–49 ms en corpus de hasta 19.000 documentos.

Búsqueda semántica local (sin LLM)

La búsqueda semántica te permite encontrar documentos por significado, no solo por palabras exactas. Esto se logra con modelos de embeddings pequeños que corren en CPU, no con una LLM completa.

    memento (paquete memento-etch en PyPI) es una librería en Python que usa SQLite + FTS5 + vectores HRR + embeddings opcionales (BGE-small via fastembed). No necesita GPU, ni CUDA, ni API keys, y todo funciona con la librería estándar de Python. Puedes instalarlo con pip install "memento[embeddings]" y empezar a indexar y buscar en minutos.

    fidx también incluye esta capacidad: usa un modelo ONNX de 768 dimensiones para embeddings, todo en CPU, y fusiona los resultados de búsqueda léxica y semántica con Reciprocal Rank Fusion.

¿Qué puedes probar con esta ruta?

    Indexar una carpeta con tus PDFs, archivos Markdown, código y notas.

    Buscar por palabras exactas ("ansiedad", "proyecto X").

    Buscar por significado ("¿dónde hablé de cómo me sentía?").

    Ver resultados con puntuación de relevancia y fragmentos resaltados.

Esto ya es un producto útil y demostrable. No necesita LLM.
🤖 Ruta 2: Capa de IA opcional (APIs gratuitas en la nube)

Si quieres añadir la capacidad de preguntar en lenguaje natural y obtener respuestas, puedes hacerlo sin una LLM local usando APIs gratuitas en la nube. La clave es que esta capa sea opcional: el proyecto funciona sin ella, pero si hay conexión y una clave configurada, se activa la generación de respuestas.
Proveedores con tiers gratuitos generosos
Proveedor	Límite gratuito	Ventaja principal
GroqCloud	Límites diarios por modelo	Inferencia extremadamente rápida; acceso a modelos como GPT-OSS-120B o Qwen3.6-27B
OpenRouter	20 RPM, 50 RPD	Acceso a 25+ modelos gratuitos con una sola API key; puedes usar openrouter/free para enrutamiento automático
Google Gemini API	Uso gratuito en modelos seleccionados	Modelos Gemini y Gemma con límites de tokens generosos
Cloudflare Workers AI	10,000 Neuronas/día	Ideal para apps serverless; sin tarjeta de crédito
¿Cómo integrarlo sin romper la filosofía offline?

La arquitectura sería así:

    El motor de búsqueda (Ruta 1) recupera los fragmentos más relevantes de tus archivos locales.

    Construyes un prompt con esos fragmentos como contexto.

    Envías el prompt a la API gratuita (Groq, OpenRouter, etc.) solo si el usuario ha configurado una clave y tiene conexión.

    Muestras la respuesta con citas a los archivos locales de donde salió la información.

Esto se conoce como RAG (Retrieval-Augmented Generation), pero con la generación delegada a una API remota. El proyecto sigue siendo "offline-first": sin conexión, sigues teniendo búsqueda completa; con conexión, obtienes respuestas generadas.
🧠 Ruta 3: LLM local ultraligera (para probar el concepto completo)

Si quieres probar el flujo completo sin depender de internet, existen modelos extremadamente pequeños que corren en CPU, incluso en una Raspberry Pi.

    Pleias-SLM-RAG es un servidor RAG autocontenido que empaqueta un modelo GGUF de ~300 millones de parámetros (~328 MB cuantizado) con búsqueda full-text en LanceDB. Corre enteramente en CPU, sin GPU, sin llamadas externas, y los datos no salen de tu máquina. Se despliega con Docker o con Python y llama-cpp-python.

Un modelo de 300M de parámetros es mucho más pequeño que los 3B–8B que suelen requerir una GPU. Es perfectamente viable en una PC modesta, aunque la calidad de las respuestas será limitada. Sirve perfectamente para validar el flujo completo de Memex Offline.
🗺️ Hoja de ruta sugerida para probar sin LLM
Semana	Qué haces	Herramientas	¿Necesita LLM?
1	Indexar una carpeta de PDFs/TXT/MD y buscar por palabras clave	SQLite FTS5 + gret	No
2	Añadir búsqueda semántica con embeddings en CPU	fidx o memento[embeddings]	No
3	Añadir OCR para imágenes y PDFs escaneados	Tesseract	No
4	Añadir transcripción de audio/video	Whisper.cpp (modelo tiny o base)	No
5	Crear un CLI que una todo y exporte resultados	Python	No
6	(Opcional) Añadir capa de respuestas con API gratuita	Groq / OpenRouter	Sí (remota)
7	(Opcional) Probar flujo completo con LLM ultraligera	Pleias-SLM-RAG	Sí (local, 300M)
💡 Cómo probarlo y compartirlo para ganar reputación

    Empieza con la Ruta 1: un CLI que indexa una carpeta y permite buscar. Grábalo en un GIF de 30 segundos.

    Publica el MVP en GitHub con un README que explique que funciona sin LLM y que la capa de IA es opcional. Eso es un diferenciador fuerte frente a otros proyectos que asumen que tienes una GPU.

    Documenta los benchmarks en tu PC modesta: cuánto tarda en indexar, cuánto en buscar, cuánta RAM usa. Eso genera confianza.

    Publica en Reddit (r/selfhosted, r/LocalLLaMA, r/DataHoarder) con el ángulo: "Construí un Memex offline que funciona sin GPU y sin LLM local".

    Añade la capa de API remota después, como un extra. La gente podrá probar el proyecto sin configurar nada de IA y luego decidir si quiere conectar su clave gratuita de Groq.


Repositorio de Github: https://github.com/jmarc9901/memex.git