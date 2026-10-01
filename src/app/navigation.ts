import { Crown, LayoutDashboard, Swords, Trophy, UserRound } from 'lucide-react'
import type { Page } from './types'

export const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'matches', label: 'Partidas', icon: Swords },
  { id: 'tournaments', label: 'Torneos', icon: Trophy },
  { id: 'profile', label: 'Mi perfil', icon: UserRound },
  { id: 'plan', label: 'Zona de plan', icon: Crown },
]
