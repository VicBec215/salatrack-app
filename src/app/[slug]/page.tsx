import PageClientBoard from '../PageClientBoard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function CenterPage({ params }: { params: { slug: string } }) {
  return <PageClientBoard slug={params.slug} />;
}