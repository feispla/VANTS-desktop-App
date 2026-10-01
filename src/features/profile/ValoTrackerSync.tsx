import React from 'react'
import { getTrackerUrl, validateRiotHandle } from '../../utils/riotValidation'

interface ValoTrackerSyncProps {
  riotHandle: string | null
  guildId?: string
  channelId?: string
}

export const ValoTrackerSync: React.FC<ValoTrackerSyncProps> = ({ riotHandle, guildId, channelId }) => {
  const handle = riotHandle?.trim() || null
  const trackerUrl = handle && validateRiotHandle(handle) ? getTrackerUrl(handle) : null
  const valotrackerUrl = guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}` : null

  return (
    <section className="valotracker-sync card" aria-labelledby="valotracker-title">
      <div>
        <p className="eyebrow">VALOTRACKER</p>
        <h2 id="valotracker-title">Sincronización de VALORANT</h2>
      </div>
      {!handle ? (
        <p className="valotracker-copy">⚠️ No tienes cuenta de Riot vinculada. Usa <code>/vincular riot</code> en Discord.</p>
      ) : !trackerUrl ? (
        <p className="valotracker-copy">El Riot ID guardado necesita revisión antes de abrir sus estadísticas.</p>
      ) : (
        <>
          <p className="valotracker-copy"><strong>{handle}</strong> está guardada en tu perfil VANTS.</p>
          <div className="valotracker-actions">
            <a href={trackerUrl} target="_blank" rel="noopener noreferrer" className="primary-button">Stats en tracker.gg</a>
            {valotrackerUrl && <a href={valotrackerUrl} target="_blank" rel="noopener noreferrer" className="secondary-button">Abrir ValoTracker</a>}
          </div>
          <p className="valotracker-note">Usa <code>/link</code> en ValoTracker con el mismo Riot ID para sincronizar ranked.</p>
        </>
      )}
    </section>
  )
}
