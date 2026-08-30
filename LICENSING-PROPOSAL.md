# Lizenzvorschlag

Status: Vorschlag, nicht umgesetzt. Die aktuelle Lizenz bleibt unverändert, bis du
entscheidest. Ich bin kein Anwalt; das hier ist eine Produktentscheidung mit
juristischen Folgen, kein Rechtsrat.

## Das Problem mit PolyForm Noncommercial

Die heutige Lizenz erlaubt Privatnutzung, Forschung, Lehre und Gemeinnütziges.
Nicht erlaubt ist damit:

- jemand, der sich **im Job** eine Auswertung baut,
- ein **Freiberufler**, der einem Kunden ein Werkzeug baut,
- eine Firma, die AI-Graph **intern** ausprobiert, bevor sie fragt.

Das sind genau die drei Fälle, aus denen Nutzer werden. Zum Vergleich: n8ns
Sustainable Use License gibt interne Firmennutzung ausdrücklich frei und verbietet
nur Weiterverkauf und Hosting für Dritte — sie ist an der entscheidenden Stelle
großzügiger als deine.

## Das übersehene Problem: das Bundle enthält deinen Code

Das ist wichtiger als die Wahl der Lizenz selbst.

`deploy_service.py` kopiert die **echte Engine** in jedes Bundle — `app/elements/**`,
`app/models/graph.py`, die portablen `app/services/*.py`. Wer einen Graphen deployt
und die entstandene `.exe` weitergibt, **verbreitet damit dein Werk**.

Das ist kein Randfall, sondern dein Kernversprechen. Jede Lizenz, die du wählst,
muss diesen Weg ausdrücklich erlauben — sonst ist das Hauptfeature vertraglich
kaputt, und zwar unabhängig davon, wie freundlich der Rest der Lizenz ist.

Keine der Standardlizenzen adressiert das von sich aus. Es braucht eine eigene
Klausel.

## Empfehlung

**Functional Source License 1.1 mit Apache-2.0-Rückfall** (`FSL-1.1-ALv2`), plus
die Bundle-Klausel unten.

Warum FSL und nicht PolyForm Shield:

| | FSL-1.1-ALv2 | PolyForm Shield 1.0.0 | n8n Sustainable Use |
|---|---|---|---|
| Interne Firmennutzung | frei | frei | frei |
| Kundenarbeit / Freiberufler | frei | frei | **nicht erlaubt** |
| Weitergabe (auch kommerziell) | frei, solange kein Wettbewerb | frei, solange kein Wettbewerb | eingeschränkt |
| Konkurrenzprodukt / Hosting als Dienst | verboten | verboten | verboten |
| Wird irgendwann Open Source | **ja, nach 2 Jahren je Version** | nein | nein |

Der letzte Punkt ist für dich mehr als Kosmetik. Dein Verkaufsargument ist
Vertrauen: lokal, nachprüfbar, kein Konto. Eine Lizenz, die jede Version nach zwei
Jahren automatisch unter Apache 2.0 stellt, macht aus „vertrau mir" ein
„du bist nicht ausgeliefert" — jemand, der ein Werkzeug für die nächsten fünf Jahre
weitergibt, hat eine Garantie, dass es ihm nicht entzogen werden kann. Für ein
Ein-Personen-Projekt, dem man sonst mit Recht misstraut, ist das der billigste
Vertrauensvorschuss, den du kaufen kannst.

Shield ist die Alternative, wenn du diese Selbstbindung nicht willst. Alles andere
an der Empfehlung bleibt dann gleich.

## Die Bundle-Klausel

Das gehört in die `Required Notice`-Kopfzeile deiner LICENSE, über den eigentlichen
Lizenztext:

```
Required Notice: Copyright Mirko Meuter (https://github.com/Archimedes79/AI_Graph)

  Zusätzliche Erlaubnis für Deploy-Bundles
  ---------------------------------------
  Ein "Deploy-Bundle" ist das Ergebnis der Deploy-Funktion dieser Software: ein
  Paket oder eine ausführbare Datei, die deinen Graphen zusammen mit einer
  unveränderten Kopie der Ausführungs-Engine dieser Software enthält.

  Du darfst Deploy-Bundles ohne Einschränkung erstellen, benutzen und weitergeben,
  auch kommerziell, auch an Dritte, auch gegen Bezahlung, und auch dann, wenn du
  die Software im Übrigen nur unter den Bedingungen unten nutzen darfst. Diese
  Erlaubnis erstreckt sich ausdrücklich auf die mitgelieferte Kopie der Engine.

  Sie erstreckt sich nicht auf den Editor: ein Deploy-Bundle darf keine Oberfläche
  zum Erstellen oder Bearbeiten von Graphen enthalten oder anbieten.
```

Der letzte Absatz ist die Grenze, auf die es ankommt. Er trennt sauber:

- **Werkzeug weitergeben** — immer erlaubt, das ist das Produkt.
- **Editor weitergeben oder als Dienst anbieten** — das ist der Wettbewerbsfall,
  den die Lizenz verhindern soll.

Praktisch heißt das: der Freiberufler darf seinem Kunden das fertige Werkzeug
verkaufen. Wer AI-Graph als gehosteten Graph-Editor anbieten will, braucht eine
kommerzielle Lizenz.

## Was dabei sonst zu tun ist

1. **Umstellung ist rückwirkend nicht möglich** — alle bisher veröffentlichten
   Commits bleiben unter PolyForm Noncommercial. In der Praxis egal, solange es
   keine Forks gibt, aber der Wechsel gilt ab dem Commit, in dem er passiert.
2. **`deploy_service.py` sollte die Bundle-Klausel mitliefern.** Das generierte
   `README.md` im Bundle nennt heute keine Lizenz. Eine Zeile dort, die sagt, dass
   der Empfänger dieses Werkzeug frei benutzen und weitergeben darf, nimmt die
   naheliegendste Frage vorweg.
3. **`LICENSE` ins Bundle legen.** Bisher wird sie nicht mitkopiert, obwohl das
   Bundle deinen Code enthält.
4. Die README-Zeile 535 und die Lizenzangabe in GitHub anpassen.

Punkte 2 und 3 sind zwei Zeilen in `generate_deployment_bundle`. Sag Bescheid,
dann baue ich sie ein — sie hängen aber an deiner Lizenzentscheidung, deshalb habe
ich sie nicht vorweggenommen.
