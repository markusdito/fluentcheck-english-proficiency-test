export type IpaymuTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export const fetchIpaymuTransport: IpaymuTransport = (url, init) =>
  fetch(url, init);
