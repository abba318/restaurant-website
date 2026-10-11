export type MenuItem={id:number;category_id:number|null;name:string;description:string;price_kobo:number;image_url:string;available:boolean;stock_quantity?:number|null};
export type CartItem=MenuItem&{quantity:number;specialRequest?:string};
