import { BadRequestException } from '@nestjs/common';
import { resumeStartDate } from './cv-import-merge';

type Interval = { startDate?: string | Date | null; endDate?: string | Date | null; isCurrent?: boolean };
function parse(value?: string | Date | null) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return resumeStartDate(value);
}
export function careerDates(input: Interval, experience = false, now = new Date()) {
  const startDate = parse(input.startDate);
  const endDate = input.isCurrent ? null : parse(input.endDate);
  if ((experience && !startDate) || (input.startDate && !startDate) || (!input.isCurrent && input.endDate && !endDate)) {
    throw new BadRequestException('Check selected career dates');
  }
  if (startDate && endDate && endDate < startDate) throw new BadRequestException('End date must not be before start date');
  if (experience && startDate && startDate.toISOString().slice(0, 10) > now.toISOString().slice(0, 10)) {
    throw new BadRequestException('Work experience cannot start in the future');
  }
  return { startDate, endDate };
}
