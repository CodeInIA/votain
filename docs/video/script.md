# Product video: script and shot list

Four deliverables from one capture session: a three minute demo and a ninety
second cut, each in English and Spanish. The short cut is assembled from the
long one's footage, so nothing is filmed twice.

## What this video may and may not claim

It is a pitch, and a pitch that overstates is a pitch that gets caught in the
questions afterwards. Every line below is true of the system as built:

- **True today**: ballots are encrypted in the browser, summed without being
  opened, and only the total is decrypted. Enrolment is anonymous. A voter can
  verify their own ballot. The backend runs in a TEE whose attestation reports
  the image digest. It is open source under AGPL-3.0.
- **Not said**: that anyone is using it, that it has been audited, that it is
  running on a public chain. The contracts are on a development chain until the
  Amoy deployment, so the narration says "the chain" and never "mainnet", and no
  shot shows a block explorer.
- **Said plainly at the end**: it is a bachelor's thesis. The jury knows, and an
  investor who finds out later would rather have been told.

## Structure, three minute cut

| Time | Shot | On screen |
|---|---|---|
| 0:00-0:12 | Title card over the landing background | Logo, then the question |
| 0:12-0:30 | Discover page, slow pan across the election cards | What Votain is |
| 0:30-0:50 | Sign in with World ID, the verification dialog | One person, one vote |
| 0:50-1:20 | Enrolling in an election, the anonymity chips | Eligible without being identified |
| 1:20-1:50 | Casting a ballot, the encryption step | Encrypted before it leaves the device |
| 1:50-2:20 | Results page, the vote breakdown | Only the total is ever decrypted |
| 2:20-2:40 | Verify a vote, receipt check | Check your own ballot |
| 2:40-3:00 | Organiser dashboard, then close card | Who it is for, and what it is |

## Structure, ninety second cut

Shots 1, 2, 5, 6 and 8, tightened. The World ID and enrolment sections are the
ones that go: they are the most interesting technically and the least legible in
a minute and a half.

## Narration

Timed to the shot list. The English is written first because the Spanish for
this material tends to run about fifteen per cent longer, and the shots are cut
to the longer of the two so neither version feels rushed.

### 1. Open (0:00-0:12)

> **EN** Every election asks you for the same thing. Trust. Trust that your vote
> was counted. Trust that nobody looked. Trust that the number at the end is
> real.
>
> **ES** Toda elección te pide lo mismo. Confianza. Confianza en que tu voto se
> contó. En que nadie miró. En que el número final es cierto.

### 2. What it is (0:12-0:30)

> **EN** Votain replaces that trust with proof. It is a voting platform where
> every voter can check their own ballot was counted, nobody can prove how they
> voted, and no authority can change the result.
>
> **ES** Votain sustituye esa confianza por pruebas. Es una plataforma de voto
> donde cada votante puede comprobar que su papeleta se contó, nadie puede
> demostrar a quién votó, y ninguna autoridad puede cambiar el resultado.

### 3. One person, one vote (0:30-0:50)

> **EN** You sign in with World ID. It proves you are a real person, and only
> that. Votain never sees your name, your face or your documents.
>
> **ES** Inicias sesión con World ID. Demuestra que eres una persona real, y
> nada más. Votain nunca ve tu nombre, tu cara ni tus documentos.

### 4. Eligible, and still anonymous (0:50-1:20)

> **EN** Joining an election records that you are entitled to vote, without
> recording which person you are. A zero-knowledge proof hides you inside the
> set of eligible voters. The identifier is different in every election, so two
> of your enrolments cannot be linked.
>
> **ES** Inscribirte en una elección registra que tienes derecho a votar, sin
> registrar quién eres. Una prueba de conocimiento cero te esconde dentro del
> conjunto de votantes habilitados. El identificador cambia en cada elección,
> así que dos inscripciones tuyas no se pueden enlazar.

### 5. The ballot (1:20-1:50)

> **EN** Your ballot is encrypted in your browser, before it leaves your device.
> What reaches the chain is already unreadable, to the organiser and to us.
>
> **ES** Tu papeleta se cifra en tu navegador, antes de salir del dispositivo.
> Lo que llega a la cadena es ya ilegible, para el organizador y para nosotros.

### 6. The count (1:50-2:20)

> **EN** When voting closes, the encrypted ballots are added together while
> still encrypted, and only the total is decrypted. No individual vote is ever
> opened. The count is public arithmetic, and anyone can run it again.
>
> **ES** Al cerrar la votación, las papeletas cifradas se suman sin descifrarse,
> y solo se descifra el total. Ningún voto individual llega a abrirse. El
> recuento es aritmética pública, y cualquiera puede rehacerlo.

### 7. Your own ballot (2:20-2:40)

> **EN** And you can check yours. Not a promise that it was counted. A
> verification you run yourself.
>
> **ES** Y puedes comprobar la tuya. No una promesa de que se contó. Una
> verificación que haces tú.

### 8. Close (2:40-3:00)

> **EN** Votain is open source, end to end verifiable, and built as a Computer
> Engineering bachelor's thesis. votain.app
>
> **ES** Votain es software libre, verificable de extremo a extremo, y se
> desarrolló como Trabajo de Fin de Grado en Ingeniería Informática. votain.app

## Capture notes

**Two sources, on purpose.** Interaction is recorded as video through
Playwright, at 1920x1080. Static hero shots are full resolution screenshots with
the movement added afterwards in ffmpeg, because Playwright's recording bitrate
is not configurable and small text goes soft in it.

**The pointer is drawn, not real.** Playwright's video does not include a mouse
cursor, so clicks appear to happen by themselves. A synthetic cursor is injected
and moved to each target before the click.

**The chain has to be up.** Everything on screen reads from the Hardhat node
through `rpc.votain.app`, so the node and the tunnel must be running for the
whole session, and the recording has to happen before that data changes.

**Seeded dates drift.** The demo elections advance with the chain clock, so
"ends in 3d 15h" will read differently on a later take. Either record all the
shots in one session or accept that the countdowns will not match between them.
