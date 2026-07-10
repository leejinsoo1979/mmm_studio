import { SocialAuthPanel } from '@/components/social-auth-panel'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  return <SocialAuthPanel nextPath={params.next ?? '/dashboard'} />
}
