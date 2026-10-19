import { notFound } from 'next/navigation';

/** Keep unknown locale-prefixed paths inside the product layout and recovery UI. */
export default function MissingPage() { notFound(); }
