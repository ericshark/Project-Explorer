import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.ts'

// Project pages load only this small link component; the guide renderer loads on navigation.
export function ProjectHostingLink({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: ['hosting'], queryFn: api.hosting })
  const guide = data?.guides.find((g) => g.projects.some((p) => p.id === projectId))
  return guide ? (
    <Link
      className="inline-flex items-center gap-1.5 text-[13px] text-link hover:underline"
      to={`/hosting/${guide.id}`}
    >
      <BookOpen className="size-3.5" />
      Hosting guide
    </Link>
  ) : null
}
