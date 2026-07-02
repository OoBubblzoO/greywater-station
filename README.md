# Greywater Station

**[Live demo](https://oobubblzoo.github.io/greywater-station/)**

A night-shift horror text adventure built in React.

You are a night inspector sent alone to walk the sublevels of Greywater Station Six — a decommissioned pumping station scheduled for demolition. Something is down there. It hunts by sound, and it learns from your voice.

## Mechanics

- **Sound meter** — loud choices raise it. Cross the thresholds and routes change under you. Make too much noise and it gets there first.
- **Words** — every word you speak aloud, it keeps. The ending remembers what you gave it.
- **Replayable** — multiple deaths, three survivals, tracked per session.

## Audio

All sound is synthesized live with the Web Audio API. No audio files — every drip, drone, whisper, and heartbeat is generated in the browser. Headphones recommended.

## Usage

`greywater-station.jsx` exports a single default React component. Drop it into any React project:

```jsx
import GreywaterStation from './greywater-station';

export default function App() {
  return <GreywaterStation />;
}
```

No dependencies beyond React itself.
