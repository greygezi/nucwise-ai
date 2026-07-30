import { createFileRoute } from '@tanstack/react-router'
import DifyWorkflowWorkbench from '@/components/dify/DifyWorkflowWorkbench'

export const Route = createFileRoute('/settings/workflows')({
  component: RouteComponent,
})

export function RouteComponent() {
  return <DifyWorkflowWorkbench />
}
