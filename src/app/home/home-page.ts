import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The landing page, until login (NKB-205) and the member dashboard replace it. */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.html',
})
export class HomePage {}
